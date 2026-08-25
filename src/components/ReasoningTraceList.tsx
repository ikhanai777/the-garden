import { useState } from 'react'
import type { ReasoningTrace } from '../types'
import { formatClockSeconds, formatTokens } from '../utils/format'

function TraceDisclosure({ trace }: { trace: ReasoningTrace }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mono flex w-full items-center gap-2 py-1 text-left text-[12px] text-ash transition-colors hover:text-porcelain"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>reasoning</span>
        <span className="tnum">· {formatTokens(trace.tokenCount)} tok</span>
        <span className="ml-auto">{formatClockSeconds(trace.timestamp)}</span>
      </button>
      {open && <div className="body-s pb-2 pl-4 text-[13px] text-ash">{trace.summary}</div>}
    </div>
  )
}

export function ReasoningTraceList({ traces }: { traces: ReasoningTrace[] }) {
  if (traces.length === 0) return null
  return (
    <div className="flex flex-col border-t pt-1" style={{ borderColor: 'var(--color-rule)' }}>
      {traces.slice(0, 8).map((t) => (
        <TraceDisclosure key={t.id} trace={t} />
      ))}
    </div>
  )
}
