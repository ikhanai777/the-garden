import { useSyncExternalStore } from 'react'
import { fleetEngine } from '../data/mockEngine'
import type { Agent, AgentState } from '../types'

const URGENCY: Record<AgentState, number> = {
  waiting: 0,
  failed: 1,
  blocked: 2,
  running: 3,
  spawning: 4,
  halted: 5,
  complete: 6,
}

export function sortByUrgency(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const d = URGENCY[a.state] - URGENCY[b.state]
    if (d !== 0) return d
    return b.stateSince - a.stateSince
  })
}

export function useFleet(): Agent[] {
  return useSyncExternalStore(fleetEngine.subscribe, fleetEngine.getSnapshot)
}

export function useGlobalBudget() {
  const agents = useFleet()
  void agents
  return fleetEngine.getGlobalBudget()
}
