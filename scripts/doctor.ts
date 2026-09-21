/**
 * Preflight for a local deployment. Run this before the dashboard, because
 * every way this setup fails looks identical from the UI — an empty watchlist.
 *
 *   node scripts/doctor.ts
 *   node scripts/doctor.ts --symbols BTCUSDT,SOLUSDT
 *
 * Checks the runtime, that Binance's futures API is reachable and not
 * region-blocked from this machine, that the clock is accurate enough for a
 * 1-minute strategy, that the watchlist symbols are real, and that the market
 * data WebSocket actually delivers frames.
 *
 * Exit code 0 means the dashboard will work. Non-zero names what to fix.
 */

import { parseArgs } from 'node:util'
import { BINANCE, DEFAULT_CONFIG } from '../src/signals/config.ts'

const { values } = parseArgs({
  options: {
    symbols: { type: 'string', default: DEFAULT_CONFIG.symbols.join(',') },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log('usage: node scripts/doctor.ts [--symbols BTCUSDT,ETHUSDT]')
  process.exit(0)
}

const symbols = String(values.symbols)
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

let failures = 0
let warnings = 0

function pass(name: string, detail = ''): void {
  console.log(`${green('PASS')}  ${name}${detail ? dim(` — ${detail}`) : ''}`)
}
function warn(name: string, detail: string, fix: string): void {
  warnings++
  console.log(`${yellow('WARN')}  ${name} — ${detail}`)
  console.log(`      ${dim(`fix: ${fix}`)}`)
}
function fail(name: string, detail: string, fix: string): void {
  failures++
  console.log(`${red('FAIL')}  ${name} — ${detail}`)
  console.log(`      ${dim(`fix: ${fix}`)}`)
}

console.log('scalp desk — local deployment preflight\n')

// ── 1. runtime ──────────────────────────────────────────────────────────────
{
  const [major, minor] = process.versions.node.split('.').map(Number)
  // the CLIs are .ts files run directly; type stripping is on by default from 22.18
  const ok = major > 22 || (major === 22 && minor >= 18)
  if (ok) {
    pass('node runtime', `v${process.versions.node}`)
  } else {
    fail(
      'node runtime',
      `v${process.versions.node} cannot run .ts files directly`,
      'install Node 22.18+ or 24 LTS (nodejs.org), then re-run',
    )
  }
  if (typeof globalThis.WebSocket !== 'function') {
    fail('websocket support', 'no global WebSocket in this runtime', 'upgrade to Node 22.18+ or 24 LTS')
  } else {
    pass('websocket support', 'global WebSocket present')
  }
}

// ── 2. REST reachability, region block, clock skew ──────────────────────────
let restReachable = false
{
  const name = 'futures REST api'
  const started = Date.now()
  try {
    const res = await fetch(`${BINANCE.rest}/fapi/v1/time`, { signal: AbortSignal.timeout(15_000) })
    const rtt = Date.now() - started

    if (res.status === 451) {
      fail(
        name,
        'HTTP 451 — Binance is blocking this IP by region',
        'Binance futures is unavailable in some jurisdictions, including the US. Run this on a ' +
          'network in a supported region. binance.us is a different exchange, offers no futures, ' +
          'and will not work as a substitute.',
      )
    } else if (res.status === 403) {
      fail(
        name,
        'HTTP 403 — the request was refused before reaching the market data API',
        'two common causes: (a) an outbound proxy, corporate firewall or DNS filter denying ' +
          'fapi.binance.com — check HTTPS_PROXY and any TLS-inspecting middlebox; ' +
          "(b) a region block on this IP. Run `curl -sS -o /dev/null -w '%{http_code}\\n' " +
          'https://fapi.binance.com/fapi/v1/time` directly to see which.',
      )
    } else if (!res.ok) {
      fail(name, `HTTP ${res.status} ${res.statusText}`, 'check outbound HTTPS, a proxy, or corporate TLS inspection')
    } else {
      restReachable = true
      const body = (await res.json()) as { serverTime: number }
      pass(name, `${rtt}ms round trip`)

      if (rtt > 800) {
        warn(
          'api latency',
          `${rtt}ms round trip`,
          'a 1-10 minute strategy tolerates this, but entry bands will be stale more often. ' +
            'A machine closer to ap-northeast-1 helps.',
        )
      }

      // half the round trip is the best estimate of one-way delay
      const skew = Date.now() - (body.serverTime + rtt / 2)
      const absSkew = Math.abs(skew)
      if (absSkew < 1000) {
        pass('clock accuracy', `${skew >= 0 ? '+' : ''}${skew.toFixed(0)}ms vs exchange time`)
      } else if (absSkew < 5000) {
        warn(
          'clock accuracy',
          `local clock is ${(skew / 1000).toFixed(1)}s off exchange time`,
          'enable network time sync (Windows: Settings > Time & Language > sync now; ' +
            'macOS/Linux: enable NTP). Bar timing and funding countdowns drift without it.',
        )
      } else {
        fail(
          'clock accuracy',
          `local clock is ${(skew / 1000).toFixed(1)}s off exchange time`,
          'enable NTP time sync. At this error the engine mis-times forming bars and will score stale data.',
        )
      }
    }
  } catch (err) {
    fail(
      name,
      describe(err),
      'check internet access and that fapi.binance.com is not blocked by a firewall, VPN, or DNS filter',
    )
  }
}

// ── 3. watchlist symbols are real, tradable perpetuals ──────────────────────
if (restReachable) {
  const name = 'watchlist symbols'
  try {
    const res = await fetch(`${BINANCE.rest}/fapi/v1/exchangeInfo`, { signal: AbortSignal.timeout(20_000) })
    const info = (await res.json()) as {
      symbols: Array<{ symbol: string; status: string; contractType: string; quoteAsset: string }>
    }
    const tradable = new Set(
      info.symbols
        .filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
        .map((s) => s.symbol),
    )
    const missing = symbols.filter((s) => !tradable.has(s))
    if (missing.length === 0) {
      pass(name, `${symbols.length} valid USDT perpetuals`)
    } else {
      fail(
        name,
        `not tradable USDT perpetuals: ${missing.join(', ')}`,
        'remove them from the watchlist, or use --symbols with valid ones (e.g. BTCUSDT, ETHUSDT, SOLUSDT)',
      )
    }
  } catch (err) {
    fail(name, describe(err), 'exchangeInfo is required for tick sizes and position sizing; retry when reachable')
  }
}

// ── 4. enough history to seed the indicators ────────────────────────────────
if (restReachable) {
  const name = 'kline history'
  const symbol = symbols[0] ?? 'BTCUSDT'
  try {
    const url = `${BINANCE.rest}/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=350`
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    const rows = (await res.json()) as unknown[]
    if (Array.isArray(rows) && rows.length >= 300) {
      pass(name, `${rows.length} 1m bars for ${symbol}`)
    } else {
      fail(name, `only ${Array.isArray(rows) ? rows.length : 0} bars returned`, 'the engine needs 210+ bars per symbol to score anything')
    }
  } catch (err) {
    fail(name, describe(err), 'retry; the dashboard seeds history over this endpoint on startup')
  }
}

// ── 5. the market data socket actually delivers ─────────────────────────────
if (typeof globalThis.WebSocket === 'function') {
  const name = 'market data websocket'
  const symbol = (symbols[0] ?? 'BTCUSDT').toLowerCase()
  const url = `${BINANCE.ws}?streams=${symbol}@bookTicker/${symbol}@aggTrade`
  const result = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const started = Date.now()
    let settled = false
    const finish = (ok: boolean, detail: string) => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch {
        // already closing
      }
      resolve({ ok, detail })
    }

    const ws = new WebSocket(url)
    const timer = setTimeout(() => finish(false, 'no frames within 15s'), 15_000)
    ws.onmessage = () => {
      clearTimeout(timer)
      finish(true, `first frame in ${Date.now() - started}ms`)
    }
    ws.onerror = () => {
      clearTimeout(timer)
      finish(false, 'socket error')
    }
    ws.onclose = (event) => {
      clearTimeout(timer)
      finish(false, `closed before any data (code ${event.code})`)
    }
  })

  if (result.ok) {
    pass(name, result.detail)
  } else {
    fail(
      name,
      result.detail,
      'the dashboard is live-streaming and will stay empty without this. ' +
        'Check that wss://fstream.binance.com is not blocked by a firewall or proxy that permits HTTPS but not WebSockets.',
    )
  }
}

console.log('')
if (failures > 0) {
  console.log(red(`${failures} blocking problem(s)${warnings ? `, ${warnings} warning(s)` : ''}. Fix the FAIL lines above before starting the dashboard.`))
  process.exit(1)
}
if (warnings > 0) {
  console.log(yellow(`Ready, with ${warnings} warning(s). The dashboard will run.`))
  process.exit(0)
}
console.log(green('All checks passed. Start the dashboard with: npm start'))

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'request timed out'
    return err.message
  }
  return String(err)
}
