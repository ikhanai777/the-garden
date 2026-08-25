import { useEffect, useState } from 'react'
import { useAppState } from '../hooks/useAppState'
import { useFleet, useGlobalBudget } from '../hooks/useFleet'
import { formatClock } from '../utils/format'

function BudgetBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(1, used / total) : 0
  const segments = 10
  const filled = Math.round(pct * segments)
  const bar = '█'.repeat(filled) + '░'.repeat(segments - filled)
  const color = pct >= 0.95 ? 'var(--color-flare)' : pct >= 0.8 ? 'var(--color-sodium)' : 'var(--color-iris)'
  return (
    <div className="flex items-center gap-2">
      <span className="signage text-ash">budget</span>
      <span className="mono text-[13px] tracking-tight" style={{ color }}>
        {bar}
      </span>
      <span className="mono text-[13px] text-porcelain tnum">{Math.round(pct * 100)}%</span>
    </div>
  )
}

export function StatusBar() {
  const agents = useFleet()
  const budget = useGlobalBudget()
  const { setCommandBarOpen, setHaltModalOpen, replayTime, setReplayTime, density, toggleDensity } = useAppState()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const waitingCount = agents.filter((a) => a.state === 'waiting').length
  const runningCount = agents.filter((a) => a.state === 'running' || a.state === 'blocked' || a.state === 'spawning').length

  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between gap-3 overflow-hidden border-b px-3 lg:px-4"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-slab)' }}
    >
      <div className="flex min-w-0 items-center gap-3 lg:gap-6">
        <span className="signage shrink-0 text-porcelain">Agentic OS</span>
        <button
          onClick={() => setCommandBarOpen(true)}
          className="flex shrink-0 items-center gap-2 border px-2 py-1 text-ash transition-colors hover:text-porcelain"
          style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
        >
          <span className="mono text-[11px]">⌘K</span>
          <span className="hidden text-[12px] lg:inline">search or run a command</span>
        </button>
        <div className="hidden shrink-0 sm:block">
          <BudgetBar used={budget.used} total={budget.total} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 lg:gap-5">
        {replayTime !== null && (
          <button
            onClick={() => setReplayTime(null)}
            className="signage shrink-0 px-2 py-1"
            style={{ color: 'var(--color-sodium)', border: '1px solid var(--color-sodium)', borderRadius: 'var(--radius-sm)' }}
            title="Return to live (Esc)"
          >
            ● replay
          </button>
        )}
        {waitingCount > 0 && (
          <span className="mono shrink-0 text-[13px] tnum" style={{ color: 'var(--color-sodium)' }}>
            {waitingCount} waiting
          </span>
        )}
        <span className="mono hidden shrink-0 text-[13px] text-ash tnum md:inline">{runningCount} running</span>
        <button
          onClick={toggleDensity}
          className="signage hidden shrink-0 px-2 py-1 text-ash transition-colors hover:text-porcelain lg:block"
          style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
          title="Toggle density"
        >
          {density === 'comfortable' ? 'comfortable' : 'compact'}
        </button>
        <button
          onClick={() => setHaltModalOpen(true)}
          className="signage shrink-0 px-2 py-1 text-ash transition-colors hover:text-flare"
          style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
        >
          ⏻ halt all
        </button>
        <span className="mono shrink-0 text-[13px] text-porcelain tnum">{formatClock(now)}</span>
      </div>
    </div>
  )
}
