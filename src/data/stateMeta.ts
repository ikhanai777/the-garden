import type { AgentState } from '../types'

export interface StateMeta {
  glyph: string
  color: string
  label: string
}

export const STATE_META: Record<AgentState, StateMeta> = {
  spawning: { glyph: '◇', color: 'var(--color-ash)', label: 'Spawning' },
  running: { glyph: '▮', color: 'var(--color-iris)', label: 'Running' },
  waiting: { glyph: '◆', color: 'var(--color-sodium)', label: 'Waiting on human' },
  blocked: { glyph: '▯', color: 'var(--color-ash)', label: 'Blocked' },
  failed: { glyph: '✕', color: 'var(--color-flare)', label: 'Failed' },
  complete: { glyph: '●', color: 'var(--color-jade)', label: 'Complete' },
  halted: { glyph: '▪', color: 'var(--color-flare)', label: 'Halted' },
}
