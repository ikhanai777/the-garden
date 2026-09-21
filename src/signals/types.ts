/**
 * Domain types for the Binance USDⓈ-M futures scalping signal engine.
 *
 * Everything here is exchange-shaped: prices are absolute, quantities are in
 * base asset, timestamps are epoch milliseconds. No display formatting.
 */

export type Side = 'LONG' | 'SHORT'

/** Which playbook produced a signal. They have different risk geometry. */
export type SetupKind = 'momentum' | 'reversion'

export interface Candle {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  /** base asset volume */
  volume: number
  /** quote asset volume (USDT) */
  quoteVolume: number
  /** base volume bought by takers — the aggressive-buy share of the bar */
  takerBuyVolume: number
  trades: number
  /** false while the bar is still forming */
  closed: boolean
}

export interface SymbolFilters {
  symbol: string
  tickSize: number
  stepSize: number
  minQty: number
  minNotional: number
  pricePrecision: number
  quantityPrecision: number
}

/** Best bid/ask from the bookTicker stream. */
export interface BookTop {
  bid: number
  bidQty: number
  ask: number
  askQty: number
  ts: number
}

/** Aggregated depth levels from the partial-depth stream. */
export interface DepthLevels {
  bids: Array<[price: number, qty: number]>
  asks: Array<[price: number, qty: number]>
  ts: number
}

export interface TradeTick {
  ts: number
  price: number
  qty: number
  /** true when the buyer was the maker, i.e. the aggressor was a seller */
  buyerIsMaker: boolean
}

export interface MarkInfo {
  markPrice: number
  indexPrice: number
  fundingRate: number
  nextFundingTime: number
  ts: number
}

/**
 * A single measured input to the decision. Weight is how much it can move the
 * conviction score; value is 0..1 strength in the signal's direction.
 *
 * `gate: true` factors are hard requirements — a zero value kills the setup
 * regardless of how good everything else looks.
 */
export interface Factor {
  key: string
  label: string
  weight: number
  value: number
  gate?: boolean
  /** needs live order book / trade flow; unavailable when replaying klines */
  liveOnly?: boolean
  /** human-readable measurement, e.g. "+0.42 (60s taker imbalance)" */
  detail: string
}

/** Everything the strategy looks at, computed once per evaluation. */
export interface Features {
  symbol: string
  ts: number
  price: number
  /** mid of best bid/ask when live, else last close */
  mid: number
  spreadBps: number
  /** size-weighted mid — leans toward the side with thinner liquidity */
  microPrice: number

  atr: number
  atrPct: number
  ema9: number
  ema21: number
  ema50: number
  /** (ema9 - ema21) / atr — trend separation in volatility units */
  trendSep: number
  /** per-bar drift of ema21 in ATR units over the last 10 bars */
  trendSlope: number
  adx: number

  rsi7: number
  rsi2: number
  bbUpper: number
  bbLower: number
  bbMid: number
  bbWidth: number
  /** percentile rank (0..1) of current BB width against the last 100 bars */
  bbWidthPct: number
  /** true when the band width was compressed and is now expanding */
  squeezeRelease: boolean

  vwap: number
  /** standardised distance from rolling VWAP */
  vwapZ: number
  donchianHigh: number
  donchianLow: number
  /** 0..1 position of price inside the 20-bar range */
  rangePos: number

  /** forming-bar volume vs median bar volume, normalised for elapsed time */
  volRatio: number
  /** taker buy/sell imbalance from closed bars, -1..1 */
  barFlow: number
  /** slope of cumulative volume delta across recent bars, in ATR units */
  cvdSlope: number
  /** last closed bar's wick ratios, 0..1 of total range */
  upperWick: number
  lowerWick: number
  bodyRatio: number

  /** live 15s / 60s aggressive-taker imbalance, -1..1. 0 when unavailable */
  flowFast: number
  flowSlow: number
  /** trades per second vs the recent baseline */
  tradeRate: number
  /** top-5 / top-20 book imbalance, -1..1. 0 when unavailable */
  bookImb5: number
  bookImb20: number

  fundingRate: number
  msToFunding: number
  /** (mark - last) / last in basis points */
  basisBps: number

  /** true when book/flow inputs are live rather than kline-derived */
  live: boolean
}

export interface RiskPlan {
  entry: number
  /** acceptable fill band — [lo, hi] regardless of side */
  entryZone: [number, number]
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
  /** |entry - stopLoss| */
  riskDistance: number
  riskBps: number
  /** reward:risk at TP1 and TP2, net of round-trip fees */
  rr1: number
  rr2: number
  /** hit rate this geometry needs to break even, assuming exits at TP1 */
  breakEvenWinRate: number
  /** projected minutes to TP1 given current realised volatility */
  etaMinutes: number
  /** the signal is void if price trades through this before entry fills */
  invalidation: number
  /** suggested position size for the configured account risk */
  quantity: number
  notional: number
  leverage: number
}

export type SignalStatus =
  | 'pending'
  | 'active'
  | 'tp1'
  | 'tp2'
  | 'stopped'
  | 'timeout'
  | 'cancelled'

export interface Signal {
  id: string
  symbol: string
  side: Side
  setup: SetupKind
  /** 0..100 confluence score */
  score: number
  createdAt: number
  /** pending signals die here if unfilled */
  expiresAt: number
  plan: RiskPlan
  factors: Factor[]
  /** ordered, human-readable justification */
  reasons: string[]
  snapshot: Features
}

export interface TrackedSignal extends Signal {
  status: SignalStatus
  filledAt?: number
  fillPrice?: number
  closedAt?: number
  closePrice?: number
  /** realised result in R multiples, net of fees */
  realisedR?: number
  /** live unrealised R while active */
  unrealisedR?: number
  /** best/worst excursion in R since fill */
  maxFavourableR?: number
  maxAdverseR?: number
  /** true once TP1 filled and the stop moved to break-even */
  tp1Hit?: boolean
  holdMs?: number
}

export interface PerformanceStats {
  total: number
  filled: number
  wins: number
  losses: number
  timeouts: number
  cancelled: number
  winRate: number
  /** mean R per filled signal, net of fees */
  expectancy: number
  profitFactor: number
  totalR: number
  maxDrawdownR: number
  avgHoldMs: number
  bySetup: Record<SetupKind, { filled: number; wins: number; totalR: number }>
}
