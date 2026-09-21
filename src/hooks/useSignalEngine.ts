import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG } from '../signals/config.ts'
import { SignalEngine } from '../signals/engine.ts'
import type { EngineConfig } from '../signals/config.ts'
import type { SymbolView } from '../signals/engine.ts'
import type { StreamStatus } from '../signals/stream.ts'
import type { PerformanceStats, TrackedSignal } from '../signals/types.ts'

export interface SignalEngineState {
  signals: readonly TrackedSignal[]
  open: TrackedSignal[]
  views: SymbolView[]
  stats: PerformanceStats
  status: StreamStatus
  statusDetail: string | null
  error: string | null
  config: EngineConfig
  setConfig: (patch: Partial<EngineConfig>) => void
}

/** The engine mutates tracked signals in place; this is the redraw cadence. */
const REFRESH_MS = 350

const STORAGE_KEY = 'signals.config.v1'

function loadConfig(): EngineConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<EngineConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    // private browsing, blocked storage, or a stale shape — defaults are fine
    return DEFAULT_CONFIG
  }
}

export function useSignalEngine(): SignalEngineState {
  const [config, setConfigState] = useState<EngineConfig>(loadConfig)
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [views, setViews] = useState<SymbolView[]>([])
  const [, setRevision] = useState(0)
  /** engine lives in state so render reads a value, not a ref */
  const [engine, setEngine] = useState<SignalEngine | null>(null)
  /** ...and in a ref so callbacks can reach it without re-subscribing */
  const engineRef = useRef<SignalEngine | null>(null)
  /**
   * The engine re-scores every symbol several times a second. Buffering those
   * updates and flushing them on the redraw timer keeps the terminal at one
   * render cadence instead of one render per evaluation.
   */
  const pendingViews = useRef<SymbolView[] | null>(null)

  // the effect runs once, so this render's config is the initial one
  const [initialConfig] = useState(config)

  useEffect(() => {
    const created = new SignalEngine(initialConfig, {
      onStatus: (next, detail) => {
        setStatus(next)
        setStatusDetail(detail ?? null)
      },
      onError: (message) => setError(message),
      onSymbols: (next) => {
        pendingViews.current = next
      },
      onSignal: () => setRevision((r) => r + 1),
      onSignalUpdate: () => setRevision((r) => r + 1),
    })
    engineRef.current = created
    setEngine(created)
    void created.start()

    // signals carry live P&L and countdowns, so redraw on a timer too
    const timer = setInterval(() => {
      if (pendingViews.current) {
        setViews(pendingViews.current)
        pendingViews.current = null
      }
      setRevision((r) => r + 1)
    }, REFRESH_MS)
    return () => {
      clearInterval(timer)
      created.stop()
      engineRef.current = null
      setEngine(null)
    }
  }, [initialConfig])

  const setConfig = useCallback((patch: Partial<EngineConfig>) => {
    setConfigState((previous) => {
      const next = { ...previous, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // settings just won't persist; not worth surfacing
      }
      void engineRef.current?.setConfig(patch)
      return next
    })
  }, [])

  const signals = engine ? engine.tracker.all : []
  // recomputed every redraw rather than memoised: the inputs are mutated in
  // place by the engine, so a dependency array here would go stale
  const stats = engine ? engine.tracker.stats() : emptyStats()

  return {
    signals,
    open: signals.filter((s) => s.status === 'pending' || s.status === 'active'),
    views: views.length > 0 ? views : config.symbols.map(placeholderView),
    stats,
    status,
    statusDetail,
    error,
    config,
    setConfig,
  }
}

function placeholderView(symbol: string): SymbolView {
  return {
    symbol,
    ready: false,
    price: 0,
    spreadBps: 0,
    atrPct: 0,
    score: 0,
    side: null,
    setup: null,
    veto: 'connecting',
    updatedAt: 0,
    features: null,
  }
}

function emptyStats(): PerformanceStats {
  return {
    total: 0,
    filled: 0,
    wins: 0,
    losses: 0,
    timeouts: 0,
    cancelled: 0,
    winRate: 0,
    expectancy: 0,
    profitFactor: 0,
    totalR: 0,
    maxDrawdownR: 0,
    avgHoldMs: 0,
    bySetup: {
      momentum: { filled: 0, wins: 0, totalR: 0 },
      reversion: { filled: 0, wins: 0, totalR: 0 },
    },
  }
}
