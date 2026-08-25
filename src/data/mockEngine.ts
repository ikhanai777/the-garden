import type { Agent, AgentState, ResourceMeters, Tick, ToolCall } from '../types'
import {
  APPROVAL_ACTIONS,
  ERROR_MESSAGES,
  FILE_PATHS,
  NAME_PREFIXES,
  REASONING_SUMMARIES,
  TOOL_NAMES,
  pick,
  randRange,
} from './pools'

export const TICK_MS = 250
export const MAX_TICKS = 2400 // 10 minutes of history at 250ms/tick

let uid = 0
function nextId(prefix: string) {
  uid += 1
  return `${prefix}-${uid}`
}

function freshMeters(): ResourceMeters {
  const budgetTotal = pick([20, 50, 100])
  return {
    budgetUsed: randRange(0, budgetTotal * 0.6),
    budgetTotal,
    budgetBurnoutAt: randRange(0.55, 0.95),
    contextUsed: randRange(2000, 60000),
    contextTotal: 128000,
    contextBurnoutAt: randRange(0.6, 0.97),
    toolCallRate: randRange(2, 18),
    toolCallRateMax: 30,
    wallClockSpendSec: randRange(30, 900),
    wallClockBudgetSec: 3600,
  }
}

function makeAgent(state: AgentState = 'running'): Agent {
  const name = `${pick(NAME_PREFIXES)}-${String(Math.floor(randRange(1, 99))).padStart(2, '0')}`
  const now = Date.now()
  const spawnedAt = now - randRange(0, 9 * 60_000)
  const agent: Agent = {
    id: nextId('agent'),
    name,
    state,
    reason: reasonFor(state),
    stateSince: now - randRange(0, 60_000),
    spawnedAt,
    ticks: [],
    toolCalls: [],
    reasoning: [],
    files: Array.from({ length: Math.floor(randRange(1, 5)) }, () => pick(FILE_PATHS)),
    diff: '',
    meters: freshMeters(),
    writeAccess: ['./src', './scripts'],
  }
  // seed some history
  const seedCount = Math.floor(randRange(40, 200))
  for (let i = seedCount; i > 0; i--) {
    agent.ticks.push(randomTick(now - i * TICK_MS, state))
  }
  if (state === 'waiting') {
    agent.approval = { ...pick(APPROVAL_ACTIONS), requestedAt: agent.stateSince }
  }
  return agent
}

function reasonFor(state: AgentState): string {
  switch (state) {
    case 'spawning':
      return 'initializing · resolving scope'
    case 'running':
      return pick(['streaming tool calls', 'writing files', 'crawling frontier', 'indexing batch'])
    case 'waiting':
      return 'waiting · write access'
    case 'blocked':
      return 'blocked · dependency unresolved'
    case 'failed':
      return pick(ERROR_MESSAGES)
    case 'complete':
      return 'complete · all subtasks finished'
    case 'halted':
      return 'halted by operator'
  }
}

function randomTick(t: number, state: AgentState): Tick {
  if (state === 'running' && Math.random() < 0.32) {
    return {
      t,
      duration: randRange(50, 3000),
      tokenCost: Math.floor(randRange(20, 1800)),
      toolName: pick(TOOL_NAMES),
    }
  }
  return { t }
}

const TOOL_CALL_HISTORY_MAX = 60

class FleetEngine {
  private agents: Map<string, Agent> = new Map()
  private listeners: Set<() => void> = new Set()
  private snapshot: Agent[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private globalBudgetTotal = 500
  private globalBudgetUsed = 0

  constructor() {
    const initialStates: AgentState[] = [
      'running',
      'running',
      'running',
      'running',
      'running',
      'waiting',
      'running',
      'blocked',
      'running',
      'failed',
      'complete',
      'running',
      'spawning',
      'running',
    ]
    for (const s of initialStates) {
      const a = makeAgent(s)
      this.agents.set(a.id, a)
    }
    this.recompute()
    this.start()
  }

  private recompute() {
    this.snapshot = Array.from(this.agents.values())
    this.globalBudgetUsed = this.snapshot.reduce((sum, a) => sum + a.meters.budgetUsed, 0)
  }

  private notify() {
    this.recompute()
    for (const l of this.listeners) l()
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getSnapshot = () => this.snapshot

  getGlobalBudget = () => ({ used: this.globalBudgetUsed, total: this.globalBudgetTotal })

  private start() {
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  private tick() {
    const now = Date.now()
    for (const agent of this.agents.values()) {
      this.advance(agent, now)
    }
    this.notify()
  }

  private advance(agent: Agent, now: number) {
    switch (agent.state) {
      case 'spawning': {
        agent.ticks.push({ t: now })
        if (now - agent.stateSince > randRange(1500, 4000)) {
          this.transition(agent, 'running', now)
        }
        break
      }
      case 'running': {
        const tick = randomTick(now, 'running')
        agent.ticks.push(tick)
        if (tick.duration) {
          this.recordToolCall(agent, tick, now)
        }
        agent.meters.budgetUsed = Math.min(
          agent.meters.budgetTotal,
          agent.meters.budgetUsed + randRange(0, 0.08),
        )
        agent.meters.contextUsed = Math.min(
          agent.meters.contextTotal,
          agent.meters.contextUsed + randRange(0, 40),
        )
        agent.meters.wallClockSpendSec += TICK_MS / 1000
        agent.meters.toolCallRate = Math.max(
          0,
          agent.meters.toolCallRate + randRange(-0.4, 0.4),
        )

        const r = Math.random()
        if (r < 0.0006) this.transition(agent, 'waiting', now)
        else if (r < 0.0009) this.transition(agent, 'failed', now)
        else if (r < 0.0016) this.transition(agent, 'complete', now)
        else if (r < 0.002) this.transition(agent, 'blocked', now)
        break
      }
      case 'blocked': {
        agent.ticks.push({ t: now })
        if (Math.random() < 0.02) this.transition(agent, 'running', now)
        break
      }
      case 'waiting':
      case 'failed':
      case 'complete':
      case 'halted': {
        // terminal / paused — Tide baseline holds, no new tool ticks
        agent.ticks.push({ t: now })
        break
      }
    }
    // bound history
    if (agent.ticks.length > MAX_TICKS) {
      agent.ticks.splice(0, agent.ticks.length - MAX_TICKS)
    }
  }

  private recordToolCall(agent: Agent, tick: Tick, now: number) {
    const failed = agent.state === 'running' && Math.random() < 0.04
    const call: ToolCall = {
      id: nextId('call'),
      timestamp: now,
      name: tick.toolName ?? pick(TOOL_NAMES),
      durationMs: Math.round(tick.duration ?? 0),
      tokenCost: tick.tokenCost ?? 0,
      paths: Math.random() < 0.5 ? [pick(FILE_PATHS)] : undefined,
      failed,
      error: failed ? pick(ERROR_MESSAGES) : undefined,
    }
    agent.toolCalls.unshift(call)
    if (agent.toolCalls.length > TOOL_CALL_HISTORY_MAX) agent.toolCalls.length = TOOL_CALL_HISTORY_MAX

    if (Math.random() < 0.15) {
      agent.reasoning.unshift({
        id: nextId('trace'),
        timestamp: now,
        tokenCount: Math.floor(randRange(200, 4000)),
        summary: pick(REASONING_SUMMARIES),
      })
      if (agent.reasoning.length > 20) agent.reasoning.length = 20
    }
  }

  private transition(agent: Agent, next: AgentState, now: number) {
    agent.state = next
    agent.stateSince = now
    agent.reason = reasonFor(next)
    const marker =
      next === 'waiting'
        ? 'waiting-start'
        : next === 'failed'
          ? 'failed'
          : next === 'complete'
            ? 'complete'
            : next === 'halted'
              ? 'halted'
              : next === 'blocked'
                ? 'blocked-start'
                : next === 'running'
                  ? 'running-start'
                  : undefined
    if (marker) {
      agent.ticks.push({ t: now, marker })
    }
    if (next === 'waiting') {
      agent.approval = { ...pick(APPROVAL_ACTIONS), requestedAt: now }
    } else {
      agent.approval = undefined
    }
  }

  approve(id: string) {
    const agent = this.agents.get(id)
    if (!agent || agent.state !== 'waiting') return
    this.transition(agent, 'running', Date.now())
    this.notify()
  }

  deny(id: string) {
    const agent = this.agents.get(id)
    if (!agent || agent.state !== 'waiting') return
    this.transition(agent, 'blocked', Date.now())
    agent.reason = 'blocked · approval denied'
    this.notify()
  }

  halt(id: string) {
    const agent = this.agents.get(id)
    if (!agent) return
    if (['complete', 'failed', 'halted'].includes(agent.state)) return
    this.transition(agent, 'halted', Date.now())
    this.notify()
  }

  haltAll() {
    for (const agent of this.agents.values()) {
      if (!['complete', 'failed', 'halted'].includes(agent.state)) {
        this.transition(agent, 'halted', Date.now())
      }
    }
    this.notify()
  }

  spawn() {
    const a = makeAgent('spawning')
    a.ticks = [{ t: Date.now() }]
    this.agents.set(a.id, a)
    this.notify()
    return a.id
  }
}

export const fleetEngine = new FleetEngine()
