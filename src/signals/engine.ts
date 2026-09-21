/**
 * The engine: owns per-symbol market state, decides when to look, and turns
 * accepted candidates into tracked signals.
 *
 * Ordering matters here. Price updates reach the tracker on every trade tick
 * so open signals resolve at tape resolution, while fresh evaluations are
 * throttled — scoring 300 bars of history ten times a second would burn CPU
 * to reach the same conclusion.
 */

import { BAR_MS, DEFAULT_CONFIG, FLOW_WINDOW_MS, SEED_BARS } from './config.ts'
import { computeFeatures, MIN_BARS } from './features.ts'
import { buildPlan } from './risk.ts'
import { evaluate } from './strategy.ts'
import { BinanceStream } from './stream.ts'
import { SignalTracker } from './tracker.ts'
import { fetchKlines, fetchSymbolFilters } from './exchange.ts'
import type { EngineConfig } from './config.ts'
import type { StreamStatus } from './stream.ts'
import type {
  BookTop,
  Candle,
  DepthLevels,
  Features,
  MarkInfo,
  SymbolFilters,
  TradeTick,
  TrackedSignal,
} from './types.ts'

/** How often a symbol may be re-scored. Fast enough for a 1m scalper, cheap. */
const EVAL_INTERVAL_MS = 400

export interface SymbolView {
  symbol: string
  ready: boolean
  price: number
  spreadBps: number
  atrPct: number
  /** best score seen on the last evaluation, even when it did not qualify */
  score: number
  side: 'LONG' | 'SHORT' | null
  setup: string | null
  /** why nothing was published on the last look */
  veto: string | null
  updatedAt: number
  features: Features | null
}

export interface EngineHandlers {
  onSignal?: (signal: TrackedSignal) => void
  onSignalUpdate?: (signal: TrackedSignal) => void
  onSymbols?: (views: SymbolView[]) => void
  onStatus?: (status: StreamStatus, detail?: string) => void
  onError?: (message: string) => void
}

interface SymbolState {
  symbol: string
  candles: Candle[]
  trades: TradeTick[]
  book?: BookTop
  depth?: DepthLevels
  mark?: MarkInfo
  filters?: SymbolFilters
  lastEvalAt: number
  cooldownUntil: number
  view: SymbolView
}

export class SignalEngine {
  readonly tracker: SignalTracker
  private config: EngineConfig
  private readonly states = new Map<string, SymbolState>()
  private stream: BinanceStream | null = null
  private filters = new Map<string, SymbolFilters>()
  private running = false
  private seeding = new Set<string>()
  private abort: AbortController | null = null

  private readonly handlers: EngineHandlers

  constructor(config: Partial<EngineConfig>, handlers: EngineHandlers = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.handlers = handlers
    this.tracker = new SignalTracker(this.config)
  }

  get currentConfig(): EngineConfig {
    return this.config
  }

  get symbolViews(): SymbolView[] {
    return this.config.symbols.map((s) => this.states.get(s)?.view ?? emptyView(s))
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.abort = new AbortController()
    const signal = this.abort.signal

    try {
      this.filters = await fetchSymbolFilters(signal)
    } catch (err) {
      // a teardown mid-request is not a failure worth showing anyone
      if (!isAbort(err, signal)) this.handlers.onError?.(`exchangeInfo failed: ${describe(err)}`)
      // tick sizes are recoverable per symbol from the first book update, but
      // sizing needs the real filters — stop rather than publish bad numbers
      this.running = false
      return
    }

    for (const symbol of this.config.symbols) this.ensureState(symbol)
    this.openStream()
    await Promise.all(this.config.symbols.map((s) => this.seed(s)))
  }

  stop(): void {
    this.running = false
    this.abort?.abort()
    this.abort = null
    this.stream?.stop()
    this.stream = null
  }

  /**
   * Applies new settings. Symbol changes reopen the socket; everything else
   * takes effect on the next evaluation.
   */
  async setConfig(next: Partial<EngineConfig>): Promise<void> {
    const previous = this.config
    this.config = { ...this.config, ...next }
    this.tracker.setConfig(this.config)
    const symbolsChanged =
      previous.symbols.length !== this.config.symbols.length ||
      previous.symbols.some((s, i) => s !== this.config.symbols[i])
    if (!symbolsChanged || !this.running) return

    for (const symbol of [...this.states.keys()]) {
      if (!this.config.symbols.includes(symbol)) this.states.delete(symbol)
    }
    const fresh: string[] = []
    for (const symbol of this.config.symbols) {
      if (!this.states.has(symbol)) fresh.push(symbol)
      this.ensureState(symbol)
    }
    this.openStream()
    await Promise.all(fresh.map((s) => this.seed(s)))
  }

  private ensureState(symbol: string): SymbolState {
    let state = this.states.get(symbol)
    if (!state) {
      state = {
        symbol,
        candles: [],
        trades: [],
        filters: this.filters.get(symbol),
        lastEvalAt: 0,
        cooldownUntil: 0,
        view: emptyView(symbol),
      }
      this.states.set(symbol, state)
    }
    state.filters ??= this.filters.get(symbol)
    return state
  }

  private openStream(): void {
    this.stream?.stop()
    this.stream = new BinanceStream({
      symbols: this.config.symbols,
      depth: this.config.symbols.length <= 12,
      handlers: {
        onTrade: (symbol, trade) => this.onTrade(symbol, trade),
        onBook: (symbol, book) => this.onBook(symbol, book),
        onDepth: (symbol, depth) => {
          const s = this.states.get(symbol)
          if (s) s.depth = depth
        },
        onKline: (symbol, candle) => this.onKline(symbol, candle),
        onMark: (symbol, mark) => {
          const s = this.states.get(symbol)
          if (s) s.mark = mark
        },
        onStatus: (status, detail) => this.handlers.onStatus?.(status, detail),
      },
    })
    this.stream.start()
  }

  get streamStatus(): StreamStatus {
    return this.stream?.connectionStatus ?? 'idle'
  }

  private async seed(symbol: string): Promise<void> {
    if (this.seeding.has(symbol)) return
    this.seeding.add(symbol)
    // captured now: `this.abort` is cleared by stop(), and the catch below
    // still needs to know whether this request was the thing that was aborted
    const signal = this.abort?.signal
    try {
      const candles = await fetchKlines(symbol, '1m', SEED_BARS + 50, { signal })
      const state = this.ensureState(symbol)
      // the socket may already have pushed newer bars while this was in flight
      const live = state.candles
      const merged = [...candles]
      for (const c of live) {
        const idx = merged.findIndex((m) => m.openTime === c.openTime)
        if (idx >= 0) merged[idx] = c
        else if (c.openTime > (merged.at(-1)?.openTime ?? 0)) merged.push(c)
      }
      state.candles = merged.slice(-(SEED_BARS + 50))
      state.view = { ...state.view, ready: state.candles.length >= MIN_BARS }
      this.handlers.onSymbols?.(this.symbolViews)
    } catch (err) {
      if (!isAbort(err, signal)) this.handlers.onError?.(`${symbol} history failed: ${describe(err)}`)
    } finally {
      this.seeding.delete(symbol)
    }
  }

  private onTrade(symbol: string, trade: TradeTick): void {
    const state = this.states.get(symbol)
    if (!state) return
    state.trades.push(trade)
    const cutoff = trade.ts - FLOW_WINDOW_MS
    if (state.trades.length > 64 && state.trades[0].ts < cutoff) {
      let i = 0
      while (i < state.trades.length && state.trades[i].ts < cutoff) i++
      state.trades.splice(0, i)
    }
    // open signals resolve on the tape, not on the evaluation throttle
    const changed = this.tracker.update({ symbol, price: trade.price, now: trade.ts })
    for (const s of changed) this.handlers.onSignalUpdate?.(s)
    this.maybeEvaluate(state, trade.ts)
  }

  private onBook(symbol: string, book: BookTop): void {
    const state = this.states.get(symbol)
    if (!state) return
    state.book = book
  }

  private onKline(symbol: string, candle: Candle): void {
    const state = this.states.get(symbol)
    if (!state) return
    const candles = state.candles
    const last = candles.at(-1)
    if (!last || candle.openTime > last.openTime) {
      candles.push(candle)
      if (candles.length > SEED_BARS + 50) candles.splice(0, candles.length - (SEED_BARS + 50))
    } else if (candle.openTime === last.openTime) {
      candles[candles.length - 1] = candle
    }
    if (candle.closed) this.maybeEvaluate(state, candle.closeTime, true)
  }

  private maybeEvaluate(state: SymbolState, now: number, force = false): void {
    if (!force && now - state.lastEvalAt < EVAL_INTERVAL_MS) return
    state.lastEvalAt = now
    const features = computeFeatures({
      symbol: state.symbol,
      candles: state.candles,
      now,
      book: state.book,
      depth: state.depth,
      trades: state.trades,
      mark: state.mark,
    })

    if (!features) {
      state.view = {
        ...state.view,
        ready: false,
        veto: `warming up (${state.candles.length}/${MIN_BARS} bars)`,
        updatedAt: now,
      }
      this.handlers.onSymbols?.(this.symbolViews)
      return
    }

    const result = evaluate(features, this.config)
    const base: SymbolView = {
      symbol: state.symbol,
      ready: true,
      price: features.price,
      spreadBps: features.spreadBps,
      atrPct: features.atrPct,
      score: 'candidate' in result ? result.candidate.score : 0,
      side: 'candidate' in result ? result.candidate.side : null,
      setup: 'candidate' in result ? result.candidate.setup : null,
      veto: 'veto' in result ? result.veto.reason : null,
      updatedAt: now,
      features,
    }

    if ('veto' in result) {
      state.view = base
      this.handlers.onSymbols?.(this.symbolViews)
      return
    }

    const blocked = this.publishBlocker(state, now)
    if (blocked) {
      state.view = { ...base, veto: blocked }
      this.handlers.onSymbols?.(this.symbolViews)
      return
    }

    const candidate = result.candidate
    const filters = state.filters ?? this.filters.get(state.symbol)
    if (!filters) {
      state.view = { ...base, veto: 'no exchange filters for this symbol' }
      this.handlers.onSymbols?.(this.symbolViews)
      return
    }

    const planned = buildPlan({
      side: candidate.side,
      setup: candidate.setup,
      features,
      candles: state.candles,
      filters,
      config: this.config,
    })

    if ('rejected' in planned) {
      state.view = { ...base, veto: planned.rejected }
      this.handlers.onSymbols?.(this.symbolViews)
      return
    }

    const signal = this.tracker.add({
      id: `${state.symbol}-${now}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: state.symbol,
      side: candidate.side,
      setup: candidate.setup,
      score: candidate.score,
      createdAt: now,
      expiresAt: now + this.config.entryValiditySec * 1000,
      plan: planned.plan,
      factors: candidate.factors,
      reasons: candidate.reasons,
      snapshot: features,
    })

    state.cooldownUntil = now + this.config.cooldownMs
    state.view = { ...base, veto: null }
    this.handlers.onSignal?.(signal)
    this.handlers.onSymbols?.(this.symbolViews)
  }

  private publishBlocker(state: SymbolState, now: number): string | null {
    if (now < state.cooldownUntil) {
      return `cooling down ${Math.ceil((state.cooldownUntil - now) / 1000)}s`
    }
    if (this.tracker.openFor(state.symbol).length > 0) return 'already live on this symbol'
    if (this.tracker.open.length >= this.config.maxConcurrent) {
      return `${this.config.maxConcurrent} signals already live`
    }
    // a bar that closed minutes ago means the feed is behind; do not trade it
    const last = state.candles.at(-1)
    if (!last || now - last.openTime > 3 * BAR_MS) return 'stale candle feed'
    return null
  }
}

function emptyView(symbol: string): SymbolView {
  return {
    symbol,
    ready: false,
    price: 0,
    spreadBps: 0,
    atrPct: 0,
    score: 0,
    side: null,
    setup: null,
    veto: 'waiting for history',
    updatedAt: 0,
    features: null,
  }
}

/** True when the failure is this engine being torn down, not the market data. */
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
