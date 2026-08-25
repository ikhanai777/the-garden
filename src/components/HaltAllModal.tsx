import { useState } from 'react'
import { fleetEngine } from '../data/mockEngine'
import { useAppState } from '../hooks/useAppState'
import { useFleet } from '../hooks/useFleet'

const CONFIRM_WORD = 'halt'

export function HaltAllModal() {
  const { haltModalOpen, setHaltModalOpen } = useAppState()
  const agents = useFleet()
  const [typed, setTyped] = useState('')

  if (!haltModalOpen) return null

  const runningCount = agents.filter((a) => !['complete', 'failed', 'halted'].includes(a.state)).length
  const close = () => {
    setHaltModalOpen(false)
    setTyped('')
  }
  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(10,12,18,0.6)' }}
      onClick={close}
    >
      <div
        className="flex w-[520px] flex-col gap-5 border p-6"
        style={{
          background: 'var(--color-slab)',
          borderColor: 'var(--color-flare)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-porcelain" style={{ fontSize: 32, lineHeight: '36px' }}>
          Halt {runningCount} running agent{runningCount === 1 ? '' : 's'}. In-flight tool calls finish; nothing new
          starts.
        </p>
        <div className="flex flex-col gap-2">
          <span className="signage text-ash">
            Type "{CONFIRM_WORD}" to confirm
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && confirmed) {
                fleetEngine.haltAll()
                close()
              } else if (e.key === 'Escape') {
                close()
              }
            }}
            className="mono border bg-transparent px-3 py-2 text-[15px] text-porcelain outline-none"
            style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={close}
            className="border px-4 py-1.5 text-[13px] text-ash"
            style={{ borderColor: 'var(--color-rule)', borderRadius: 'var(--radius-sm)' }}
          >
            Cancel
          </button>
          <button
            disabled={!confirmed}
            onClick={() => {
              fleetEngine.haltAll()
              close()
            }}
            className="px-4 py-1.5 text-[13px] font-medium disabled:opacity-40"
            style={{ background: 'var(--color-flare)', color: 'var(--color-void)', borderRadius: 'var(--radius-sm)' }}
          >
            Halt all
          </button>
        </div>
      </div>
    </div>
  )
}
