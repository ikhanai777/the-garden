import { motion } from 'framer-motion'
import { fleetEngine } from '../data/mockEngine'
import { useAppState } from '../hooks/useAppState'
import { useEffectiveNow } from '../hooks/useEffectiveNow'
import { sortByUrgency, useFleet } from '../hooks/useFleet'
import type { Agent } from '../types'
import { formatElapsed } from '../utils/format'
import { AgentGlyph } from './AgentGlyph'
import { ApprovalGate } from './ApprovalGate'

function AgentRow({ agent, now }: { agent: Agent; now: number }) {
  const { selectedId, select, density } = useAppState()
  const selected = selectedId === agent.id
  const waiting = agent.state === 'waiting'
  const rowH = density === 'compact' ? 36 : 48
  const dimmed = agent.state === 'complete' || agent.state === 'halted'

  return (
    <motion.button
      layout
      layoutId={agent.id}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      onClick={() => select(agent.id)}
      className="group flex w-full flex-col justify-center px-3 text-left"
      style={{
        height: rowH,
        borderLeft: waiting
          ? '2px solid var(--color-sodium)'
          : selected
            ? '1px solid var(--color-iris)'
            : '2px solid transparent',
        background: waiting ? 'var(--color-waiting-bg)' : selected ? 'var(--color-selected-bg)' : 'transparent',
        opacity: dimmed ? 0.3 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <AgentGlyph state={agent.state} size={14} />
        <span className="body-s truncate text-porcelain" style={{ fontSize: 13 }}>
          {agent.name}
        </span>
        <span className="mono tnum ml-auto shrink-0 text-[12px] text-ash">
          {formatElapsed(now - agent.stateSince)}
        </span>
      </div>
      {density === 'comfortable' && (
        <div className="mt-0.5 truncate pl-[22px] text-[13px] text-ash">{agent.reason}</div>
      )}
    </motion.button>
  )
}

export function FleetRail({ full = false }: { full?: boolean }) {
  const agents = useFleet()
  const now = useEffectiveNow()
  const sorted = sortByUrgency(agents)
  const waitingAgents = sorted.filter((a) => a.state === 'waiting')
  const primaryWaiting = waitingAgents[0]

  return (
    <div
      className={full ? 'flex min-w-0 flex-1 flex-col' : 'flex w-[260px] shrink-0 flex-col border-r'}
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-void)' }}
    >
      <div className="flex h-8 shrink-0 items-center border-b px-3" style={{ borderColor: 'var(--color-rule)' }}>
        <span className="signage text-ash">Fleet</span>
        <span className="mono tnum ml-auto text-[12px] text-ash">{agents.length}</span>
      </div>
      {primaryWaiting && <ApprovalGate agent={primaryWaiting} variant="docked" />}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((agent) => (
          <AgentRow key={agent.id} agent={agent} now={now} />
        ))}
      </div>
      <button
        onClick={() => fleetEngine.spawn()}
        className="signage flex h-9 shrink-0 items-center gap-2 border-t px-3 text-ash transition-colors hover:text-porcelain"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <span className="mono">+</span> spawn
      </button>
    </div>
  )
}
