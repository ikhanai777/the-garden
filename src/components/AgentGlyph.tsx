import { STATE_META } from '../data/stateMeta'
import type { AgentState } from '../types'

export function AgentGlyph({ state, size = 14 }: { state: AgentState; size?: number }) {
  const meta = STATE_META[state]
  return (
    <span
      className="mono inline-block text-center leading-none"
      style={{ color: meta.color, width: size, fontSize: size }}
      aria-hidden
    >
      {meta.glyph}
    </span>
  )
}
