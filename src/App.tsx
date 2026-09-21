import { CommandBar } from './components/CommandBar'
import { ContextDock } from './components/ContextDock'
import { FleetRail } from './components/FleetRail'
import { FocusStage } from './components/FocusStage'
import { HaltAllModal } from './components/HaltAllModal'
import { SignalsTerminal } from './components/signals/SignalsTerminal'
import { StatusBar } from './components/StatusBar'
import { Tide } from './components/Tide'
import { useEffect, useState } from 'react'
import { AppStateProvider, useAppState } from './hooks/useAppState'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useWindowWidth } from './hooks/useWindowWidth'

function Shell() {
  useKeyboardShortcuts()
  const width = useWindowWidth()
  const { selectedId, select, setDockCollapsed } = useAppState()
  const triage = width < 1024

  useEffect(() => {
    if (width >= 1024 && width < 1280) setDockCollapsed(true)
  }, [width, setDockCollapsed])

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--color-void)' }}>
      <StatusBar />
      <div className="flex min-h-0 flex-1">
        {triage ? (
          selectedId ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <button
                onClick={() => select('')}
                className="signage flex h-8 shrink-0 items-center gap-2 border-b px-3 text-ash"
                style={{ borderColor: 'var(--color-rule)' }}
              >
                ← back to fleet
              </button>
              <FocusStage />
            </div>
          ) : (
            <FleetRail full />
          )
        ) : (
          <>
            <FleetRail />
            <FocusStage />
            <ContextDock />
          </>
        )}
      </div>
      <Tide />
      <CommandBar />
      <HaltAllModal />
    </div>
  )
}

/**
 * Two surfaces share this app: the agent supervision console at `#/`, and the
 * Binance futures scalp desk at `#/signals`. A hash route keeps them fully
 * independent — the signals engine holds a live socket, so it must unmount
 * cleanly rather than run behind the dashboard.
 */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function App() {
  const hash = useHashRoute()

  if (hash.startsWith('#/signals')) {
    return <SignalsTerminal onExit={() => { window.location.hash = '#/' }} />
  }

  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  )
}

export default App
