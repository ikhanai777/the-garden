import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Density = 'comfortable' | 'compact'
export type DockTab = 'files' | 'diff' | 'tools' | 'budget'

interface AppStateValue {
  selectedId: string | null
  select: (id: string) => void
  replayTime: number | null
  setReplayTime: (t: number | null) => void
  density: Density
  toggleDensity: () => void
  dockCollapsed: boolean
  toggleDock: () => void
  setDockCollapsed: (v: boolean) => void
  dockTab: DockTab
  setDockTab: (t: DockTab) => void
  commandBarOpen: boolean
  setCommandBarOpen: (v: boolean) => void
  haltModalOpen: boolean
  setHaltModalOpen: (v: boolean) => void
}

const AppStateContext = createContext<AppStateValue | null>(null)

const DENSITY_KEY = 'agentic-os.density'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replayTime, setReplayTime] = useState<number | null>(null)
  const [density, setDensity] = useState<Density>(() => {
    const saved = localStorage.getItem(DENSITY_KEY)
    return saved === 'compact' ? 'compact' : 'comfortable'
  })
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [dockTab, setDockTab] = useState<DockTab>('tools')
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const [haltModalOpen, setHaltModalOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density)
  }, [density])

  const select = useCallback((id: string) => setSelectedId(id), [])
  const toggleDensity = useCallback(
    () => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable')),
    [],
  )
  const toggleDock = useCallback(() => setDockCollapsed((v) => !v), [])

  const value = useMemo<AppStateValue>(
    () => ({
      selectedId,
      select,
      replayTime,
      setReplayTime,
      density,
      toggleDensity,
      dockCollapsed,
      toggleDock,
      setDockCollapsed,
      dockTab,
      setDockTab,
      commandBarOpen,
      setCommandBarOpen,
      haltModalOpen,
      setHaltModalOpen,
    }),
    [selectedId, select, replayTime, density, toggleDensity, dockCollapsed, toggleDock, dockTab, commandBarOpen, haltModalOpen],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
