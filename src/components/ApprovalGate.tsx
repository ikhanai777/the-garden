import { fleetEngine } from '../data/mockEngine'
import { useEffectiveNow } from '../hooks/useEffectiveNow'
import type { Agent } from '../types'
import { formatElapsed } from '../utils/format'

function Counter({ since }: { since: number }) {
  const now = useEffectiveNow()
  return <span className="mono tnum text-[13px] text-sodium">{formatElapsed(now - since)}</span>
}

export function ApprovalGate({ agent, variant }: { agent: Agent; variant: 'inline' | 'docked' }) {
  const approval = agent.approval
  if (!approval) return null

  if (variant === 'docked') {
    return (
      <div
        className="mx-2 my-2 flex flex-col gap-2 border p-2"
        style={{ borderColor: 'var(--color-sodium)', background: 'var(--color-waiting-bg)', borderRadius: 'var(--radius-sm)' }}
        role="alert"
      >
        <div className="flex items-center justify-between">
          <span className="body-s text-porcelain" style={{ fontSize: 13 }}>
            {agent.name}
          </span>
          <Counter since={approval.requestedAt} />
        </div>
        <div className="text-[12px] leading-snug text-ash">{approval.action}</div>
        <div className="flex gap-1.5">
          <button
            onClick={() => fleetEngine.approve(agent.id)}
            className="flex-1 py-1 text-[12px] font-medium"
            style={{ background: 'var(--color-sodium)', color: 'var(--color-void)', borderRadius: 'var(--radius-sm)' }}
          >
            Approve
          </button>
          <button
            onClick={() => fleetEngine.deny(agent.id)}
            className="flex-1 border py-1 text-[12px] text-ash transition-colors hover:text-flare"
            style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
          >
            Deny
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-4 border p-4"
      style={{ borderColor: 'var(--color-sodium)', background: 'var(--color-waiting-bg)', borderRadius: 'var(--radius-sm)' }}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center justify-between">
        <span className="signage text-sodium">Waiting on approval</span>
        <Counter since={approval.requestedAt} />
      </div>

      <div className="body flex flex-col gap-3" style={{ fontSize: 15, lineHeight: '24px' }}>
        <p className="text-porcelain">{approval.action}</p>
        <div
          className="mono border-l-2 py-1 pl-3 text-[13px] text-porcelain"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          {approval.artifact}
        </div>
        <p className="text-[13px] text-ash">{approval.scope}</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => fleetEngine.approve(agent.id)}
          className="px-4 py-1.5 text-[13px] font-medium"
          style={{ background: 'var(--color-sodium)', color: 'var(--color-void)', borderRadius: 'var(--radius-sm)' }}
        >
          Approve
        </button>
        <button
          onClick={() => fleetEngine.approve(agent.id)}
          className="border px-4 py-1.5 text-[13px] text-porcelain"
          style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
        >
          Approve for this session
        </button>
        <button
          onClick={() => fleetEngine.deny(agent.id)}
          className="border px-4 py-1.5 text-[13px] text-ash transition-colors hover:text-flare"
          style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
        >
          Deny
        </button>
        <span className="mono ml-auto self-center text-[11px] text-ash">⏎ approve · ⇧⏎ session · ⌫ deny</span>
      </div>
    </div>
  )
}
