import { useEffect, useMemo } from 'react'
import { fleetEngine } from '../data/mockEngine'
import { STATE_META } from '../data/stateMeta'
import { useAppState } from '../hooks/useAppState'
import { useEffectiveNow } from '../hooks/useEffectiveNow'
import { sortByUrgency, useFleet } from '../hooks/useFleet'
import { formatElapsed } from '../utils/format'
import { AgentGlyph } from './AgentGlyph'
import { ApprovalGate } from './ApprovalGate'
import { ReasoningTraceList } from './ReasoningTraceList'
import { ToolCallBlock } from './ToolCallBlock'

export function FocusStage() {
  const agents = useFleet()
  const { selectedId, select, replayTime } = useAppState()
  const now = useEffectiveNow()

  useEffect(() => {
    if (selectedId === null && agents.length > 0) {
      select(sortByUrgency(agents)[0].id)
    }
  }, [selectedId, agents, select])

  const agent = agents.find((a) => a.id === selectedId)

  const visibleToolCalls = useMemo(() => {
    if (!agent) return []
    if (replayTime === null) return agent.toolCalls
    return agent.toolCalls.filter((c) => c.timestamp <= replayTime)
  }, [agent, replayTime])

  const visibleReasoning = useMemo(() => {
    if (!agent) return []
    if (replayTime === null) return agent.reasoning
    return agent.reasoning.filter((r) => r.timestamp <= replayTime)
  }, [agent, replayTime])

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <p style={{ fontSize: 32, lineHeight: '36px' }} className="text-porcelain">
          No agents running.
        </p>
        <p className="text-[15px] text-ash">
          <span className="mono">⌘K</span> to spawn one.
        </p>
      </div>
    )
  }

  if (!agent) {
    return <div className="flex-1" />
  }

  const meta = STATE_META[agent.state]
  const canHalt = !['complete', 'failed', 'halted'].includes(agent.state)

  return (
    <div className="flex min-w-[640px] flex-1 flex-col overflow-hidden">
      <div
        className="flex h-14 shrink-0 items-center gap-3 border-b px-5"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <AgentGlyph state={agent.state} size={16} />
        <span className="body text-porcelain" style={{ fontSize: 15, fontWeight: 500 }}>
          {agent.name}
        </span>
        <span className="signage" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="mono tnum text-[13px] text-ash">{formatElapsed(now - agent.stateSince)}</span>
        <div className="ml-auto flex items-center gap-2">
          {canHalt && (
            <button
              onClick={() => fleetEngine.halt(agent.id)}
              className="signage border px-3 py-1 text-ash transition-colors hover:text-flare"
              style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
            >
              halt
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-[900px] flex-col gap-4">
          {agent.state === 'waiting' && <ApprovalGate agent={agent} variant="inline" />}

          <div className="flex flex-col gap-1">
            {visibleToolCalls.length === 0 ? (
              <p className="text-[13px] text-ash">No tool calls yet.</p>
            ) : (
              visibleToolCalls.map((call) => <ToolCallBlock key={call.id} call={call} />)
            )}
          </div>

          <ReasoningTraceList traces={visibleReasoning} />
        </div>
      </div>
    </div>
  )
}
