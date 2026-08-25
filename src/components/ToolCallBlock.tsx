import { useState } from 'react'
import type { ToolCall } from '../types'
import { formatClockSeconds, formatDuration, formatTokens } from '../utils/format'

export function ToolCallBlock({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const paths = call.paths ?? []
  const visiblePaths = expanded ? paths : paths.slice(0, 1)
  const hiddenCount = paths.length - visiblePaths.length

  return (
    <div
      className="border-l-2 py-2 pl-3"
      style={{
        borderColor: call.failed ? 'var(--color-flare)' : 'transparent',
        background: call.failed ? '#1C1417' : 'transparent',
      }}
    >
      <div className="mono flex items-baseline gap-3 text-[13px]">
        <span className="text-ash">{formatClockSeconds(call.timestamp)}</span>
        <span className="body-s text-porcelain">{call.name}</span>
        <span className="tnum ml-auto shrink-0 text-ash">
          {formatDuration(call.durationMs)} · {formatTokens(call.tokenCost)} tok
        </span>
      </div>
      <div className="mt-1 h-px" style={{ background: 'var(--color-rule)' }} />
      {call.failed ? (
        <div className="mt-1.5 text-[13px] text-porcelain">{call.error}</div>
      ) : (
        visiblePaths.length > 0 && (
          <div className="mono mt-1.5 flex flex-col gap-0.5 text-[13px] text-ash">
            {visiblePaths.map((p) => (
              <div key={p}>{p}</div>
            ))}
            {hiddenCount > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className="mt-0.5 flex items-center gap-2 text-left text-ash transition-colors hover:text-porcelain"
              >
                <span>› {hiddenCount} more paths</span>
                <span className="text-[11px]">[ expand ]</span>
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}
