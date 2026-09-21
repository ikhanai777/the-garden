/** Display helpers for the signals UI. Presentation only — no math the engine relies on. */

/** Prices vary from 0.00001 to 100000 across perpetuals; scale the precision. */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return '—'
  const abs = Math.abs(price)
  const decimals = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 7
  return price.toFixed(decimals)
}

export function formatPct(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatR(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`
}

export function formatBps(value: number): string {
  return `${value.toFixed(1)}bps`
}

export function formatAge(ms: number): string {
  if (ms < 0) return '0s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`
  return `$${value.toFixed(0)}`
}
