/**
 * Every tunable in one place. The defaults are deliberately strict: this
 * engine is built to emit a handful of high-confluence scalps per hour across
 * a watchlist, not a signal every minute.
 */

export interface EngineConfig {
  /** symbols to watch, upper-case Binance USDⓈ-M perpetuals */
  symbols: string[]
  /** minimum conviction (0..100) before a signal is published */
  minScore: number
  /** widest tolerated spread at entry; wider books eat a scalp's edge */
  maxSpreadBps: number
  /** reject a symbol whose 1m ATR is below this fraction of price — nothing to capture */
  minAtrPct: number
  /** ...and above this, where 1m stops get run on noise */
  maxAtrPct: number
  /** per-symbol quiet period after publishing a signal */
  cooldownMs: number
  /** cap on simultaneously live (pending + active) signals */
  maxConcurrent: number
  /** a pending signal that has not filled inside this window is cancelled */
  entryValiditySec: number
  /** hard time stop — the whole premise of the engine is 1-10 minute holds */
  maxHoldMinutes: number
  /** reject a setup whose projected time to TP1 exceeds this */
  maxEtaMinutes: number
  /** stand aside this long either side of funding settlement */
  fundingBlackoutMin: number
  /** |funding rate| above which positioning is too crowded to fade or follow */
  maxFundingRate: number
  /**
   * Round-trip commission in basis points. Signals enter on a limit inside the
   * published band and exit on a stop/target, so the realistic default is
   * maker-in + taker-out at Binance USDⓈ-M standard rates: 2.0 + 5.0 = 7 bps.
   * Raise to 10 if you intend to market into every entry.
   */
  feeBps: number
  /** allowance for adverse fill on the exit, in basis points */
  slippageBps: number
  /** TP1 must clear this multiple of round-trip cost to be worth taking */
  minEdgeOverFees: number
  /** account equity used for position sizing */
  equityUsd: number
  /** fraction of equity risked between entry and stop */
  riskPerTrade: number
  /** leverage cap used when suggesting a size */
  maxLeverage: number
  /** enable/disable each playbook */
  enableMomentum: boolean
  enableReversion: boolean
}

export const DEFAULT_CONFIG: EngineConfig = {
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
  minScore: 72,
  maxSpreadBps: 3.5,
  // 12 bps of 1m range is roughly the floor at which a scalp can pay 8 bps of
  // costs and still leave something. Below it the engine stands aside — which
  // means majors go quiet in calm sessions, by design.
  minAtrPct: 0.0012,
  maxAtrPct: 0.012,
  cooldownMs: 90_000,
  maxConcurrent: 4,
  entryValiditySec: 45,
  maxHoldMinutes: 10,
  maxEtaMinutes: 6,
  fundingBlackoutMin: 3,
  maxFundingRate: 0.0015,
  feeBps: 7,
  slippageBps: 1,
  minEdgeOverFees: 2,
  equityUsd: 10_000,
  riskPerTrade: 0.005,
  maxLeverage: 20,
  enableMomentum: true,
  enableReversion: true,
}

/**
 * Total round-trip friction in basis points. One definition, used by the
 * planner, the live tracker and the backtester alike — the single most common
 * way a scalping backtest lies is by costing trades differently than it prices
 * them.
 */
export function roundTripCostBps(config: EngineConfig): number {
  return config.feeBps + config.slippageBps
}

/** Binance USDⓈ-M endpoints. Public market data only — no key, no signing. */
export const BINANCE = {
  rest: 'https://fapi.binance.com',
  ws: 'wss://fstream.binance.com/stream',
} as const

export const BAR_MS = 60_000
/** how much 1m history to seed before a symbol is allowed to signal */
export const SEED_BARS = 300
/** rolling aggTrade retention, long enough for the 60s flow window */
export const FLOW_WINDOW_MS = 90_000
