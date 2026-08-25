import { mockDiff } from '../data/mockDiff'
import { useAppState } from '../hooks/useAppState'
import { useFleet } from '../hooks/useFleet'
import type { Agent } from '../types'
import { formatElapsed, formatMoney, formatTokens } from '../utils/format'
import { ResourceMeter } from './ResourceMeter'
import type { DockTab } from '../hooks/useAppState'

const TABS: { id: DockTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'diff', label: 'Diff' },
  { id: 'tools', label: 'Tools' },
  { id: 'budget', label: 'Budget' },
]

function FilesPanel({ agent }: { agent: Agent }) {
  if (agent.files.length === 0) return <p className="text-[13px] text-ash">No files touched yet.</p>
  return (
    <div className="mono flex flex-col gap-2 text-[13px]">
      {agent.files.map((f) => (
        <div key={f} className="truncate text-porcelain">
          {f}
        </div>
      ))}
    </div>
  )
}

function DiffPanel({ agent }: { agent: Agent }) {
  const lines = mockDiff(agent)
  return (
    <div className="mono flex flex-col text-[13px] leading-5">
      {lines.map((l, i) => (
        <div
          key={i}
          className="whitespace-pre px-2"
          style={{
            color: l.kind === 'add' ? 'var(--color-jade)' : l.kind === 'del' ? 'var(--color-flare)' : 'var(--color-ash)',
            background: l.kind === 'add' ? 'rgba(63,191,143,0.08)' : l.kind === 'del' ? 'rgba(255,90,78,0.08)' : 'transparent',
          }}
        >
          {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
          {l.text}
        </div>
      ))}
    </div>
  )
}

function ToolsPanel({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="signage text-ash">File access</span>
        <div className="mono mt-2 flex flex-col gap-1.5 text-[13px]">
          {agent.writeAccess.map((scope) => (
            <div key={scope} className="flex items-center justify-between">
              <span className="text-porcelain">{scope}</span>
              <button className="text-[11px] text-ash transition-colors hover:text-flare">revoke</button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <span className="signage text-ash">Recent calls</span>
        <div className="mt-2 flex flex-col gap-1">
          {agent.toolCalls.slice(0, 8).map((c) => (
            <div key={c.id} className="mono flex justify-between text-[12px] text-ash">
              <span className="text-porcelain">{c.name}</span>
              <span className="tnum">{formatTokens(c.tokenCost)} tok</span>
            </div>
          ))}
          {agent.toolCalls.length === 0 && <p className="text-[13px] text-ash">No calls yet.</p>}
        </div>
      </div>
    </div>
  )
}

function BudgetPanel({ agent }: { agent: Agent }) {
  const m = agent.meters
  return (
    <div className="flex flex-col gap-5">
      <ResourceMeter
        label="Budget"
        value={m.budgetUsed}
        max={m.budgetTotal}
        displayValue={`${formatMoney(m.budgetUsed)} / ${formatMoney(m.budgetTotal)}`}
        burnoutAt={m.budgetBurnoutAt}
      />
      <ResourceMeter
        label="Context window"
        value={m.contextUsed}
        max={m.contextTotal}
        displayValue={`${formatTokens(m.contextUsed)} / ${formatTokens(m.contextTotal)} tok`}
        burnoutAt={m.contextBurnoutAt}
      />
      <ResourceMeter
        label="Tool-call rate"
        value={m.toolCallRate}
        max={m.toolCallRateMax}
        displayValue={`${m.toolCallRate.toFixed(1)} / min`}
      />
      <ResourceMeter
        label="Wall-clock spend"
        value={m.wallClockSpendSec}
        max={m.wallClockBudgetSec}
        displayValue={formatElapsed(m.wallClockSpendSec * 1000)}
      />
    </div>
  )
}

export function ContextDock() {
  const { dockCollapsed, toggleDock, dockTab, setDockTab, selectedId } = useAppState()
  const agents = useFleet()
  const agent = agents.find((a) => a.id === selectedId)

  if (dockCollapsed) {
    return (
      <div
        className="flex w-12 shrink-0 flex-col items-center gap-4 border-l py-3"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-void)' }}
      >
        <button
          onClick={toggleDock}
          className="signage text-ash transition-colors hover:text-porcelain"
          title="Expand dock (⌘\)"
        >
          ⟨
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setDockTab(t.id)
              toggleDock()
            }}
            className="signage text-ash transition-colors hover:text-porcelain"
            style={{ writingMode: 'vertical-rl' }}
          >
            {t.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className="flex w-[380px] shrink-0 flex-col border-l"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-void)' }}
    >
      <div className="flex h-8 shrink-0 items-center border-b" style={{ borderColor: 'var(--color-rule)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setDockTab(t.id)}
            className="signage h-full px-3"
            style={{
              color: dockTab === t.id ? 'var(--color-porcelain)' : 'var(--color-ash)',
              borderBottom: dockTab === t.id ? '2px solid var(--color-iris)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={toggleDock}
          className="signage ml-auto px-3 text-ash transition-colors hover:text-porcelain"
          title="Collapse dock (⌘\)"
        >
          ⟩
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!agent ? (
          <p className="text-[13px] text-ash">Select an agent to inspect.</p>
        ) : dockTab === 'files' ? (
          <FilesPanel agent={agent} />
        ) : dockTab === 'diff' ? (
          <DiffPanel agent={agent} />
        ) : dockTab === 'tools' ? (
          <ToolsPanel agent={agent} />
        ) : (
          <BudgetPanel agent={agent} />
        )}
      </div>
    </div>
  )
}
