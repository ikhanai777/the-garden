import { useEffect } from 'react'
import { fleetEngine } from '../data/mockEngine'
import { useAppState } from './useAppState'
import { sortByUrgency, useFleet } from './useFleet'

const SCRUB_STEP_MS = 10_000

export function useKeyboardShortcuts() {
  const agents = useFleet()
  const {
    selectedId,
    select,
    replayTime,
    setReplayTime,
    commandBarOpen,
    setCommandBarOpen,
    haltModalOpen,
    setHaltModalOpen,
    toggleDock,
  } = useAppState()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA'].includes(target.tagName)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandBarOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggleDock()
        return
      }
      if (typing || commandBarOpen || haltModalOpen) return

      const sorted = sortByUrgency(agents)

      if (e.key === 'Escape') {
        if (replayTime !== null) setReplayTime(null)
        return
      }
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault()
        const idx = sorted.findIndex((a) => a.id === selectedId)
        const next = sorted[Math.min(sorted.length - 1, idx + 1)] ?? sorted[0]
        if (next) select(next.id)
        return
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        const idx = sorted.findIndex((a) => a.id === selectedId)
        const prev = sorted[Math.max(0, idx - 1)] ?? sorted[0]
        if (prev) select(prev.id)
        return
      }
      if (e.key === 'Enter') {
        const agent = sorted.find((a) => a.id === selectedId)
        if (agent?.state === 'waiting') {
          e.preventDefault()
          if (e.shiftKey) fleetEngine.approve(agent.id)
          else fleetEngine.approve(agent.id)
        }
        return
      }
      if (e.key === 'Backspace') {
        const agent = sorted.find((a) => a.id === selectedId)
        if (agent?.state === 'waiting') {
          e.preventDefault()
          fleetEngine.deny(agent.id)
        }
        return
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        setReplayTime((replayTime ?? Date.now()) - SCRUB_STEP_MS)
        return
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        const next = (replayTime ?? Date.now()) + SCRUB_STEP_MS
        setReplayTime(next >= Date.now() ? null : next)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    agents,
    selectedId,
    select,
    replayTime,
    setReplayTime,
    commandBarOpen,
    setCommandBarOpen,
    haltModalOpen,
    setHaltModalOpen,
    toggleDock,
  ])
}
