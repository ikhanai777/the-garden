import { useAppState } from './useAppState'
import { useNow } from './useNow'

/** Live clock, or frozen at the scrubbed replay instant. */
export function useEffectiveNow(): number {
  const { replayTime } = useAppState()
  const now = useNow(1000)
  return replayTime ?? now
}
