import { formatR } from '../../signals/format.ts'
import type { PerformanceStats } from '../../signals/types.ts'

/**
 * Measured results for this session. Deliberately shows the sample size next
 * to the hit rate: a 100% win rate over four trades is not an edge, and the
 * panel should make that obvious rather than flattering.
 */
export function Scoreboard({ stats }: { stats: PerformanceStats }) {
  const thin = stats.filled < 30
  return (
    <section className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--color-rule)' }}>
      <div className="flex items-baseline justify-between">
        <span className="signage text-ash">measured this session</span>
        <span className="mono tnum text-[11px] text-ash">{stats.filled} resolved</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        <Metric
          label="hit rate"
          value={stats.filled > 0 ? `${(stats.winRate * 100).toFixed(1)}%` : '—'}
          tint={stats.winRate >= 0.5 ? 'var(--color-jade)' : 'var(--color-flare)'}
        />
        <Metric
          label="expectancy"
          value={stats.filled > 0 ? formatR(stats.expectancy) : '—'}
          tint={stats.expectancy >= 0 ? 'var(--color-jade)' : 'var(--color-flare)'}
        />
        <Metric label="total" value={stats.filled > 0 ? formatR(stats.totalR) : '—'} />
        <Metric
          label="profit factor"
          value={stats.filled > 0 ? (Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞') : '—'}
        />
        <Metric label="max drawdown" value={stats.filled > 0 ? `${stats.maxDrawdownR.toFixed(1)}R` : '—'} />
        <Metric
          label="avg hold"
          value={stats.filled > 0 ? `${(stats.avgHoldMs / 60_000).toFixed(1)}min` : '—'}
        />
      </div>

      <table className="mt-3 w-full text-[11px]">
        <tbody>
          {(['momentum', 'reversion'] as const).map((setup) => {
            const bucket = stats.bySetup[setup]
            return (
              <tr key={setup} className="text-ash">
                <td className="py-0.5">{setup}</td>
                <td className="mono tnum py-0.5 text-right">{bucket.filled}</td>
                <td className="mono tnum py-0.5 text-right">
                  {bucket.filled > 0 ? `${((bucket.wins / bucket.filled) * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="mono tnum py-0.5 text-right text-porcelain">
                  {bucket.filled > 0 ? formatR(bucket.totalR) : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="text-ash">
            <td className="py-0.5">unfilled</td>
            <td className="mono tnum py-0.5 text-right" colSpan={3}>
              {stats.cancelled}
            </td>
          </tr>
        </tbody>
      </table>

      {thin ? (
        <p className="mt-2 text-[11px] text-ash">
          {stats.filled === 0
            ? 'No resolved signals yet. Numbers appear as signals fill and close.'
            : `Sample of ${stats.filled}. Nothing here is significant below ~30 trades.`}
        </p>
      ) : null}
    </section>
  )
}

function Metric({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div>
      <div className="signage text-[9px] tracking-[0.06em] text-ash">{label}</div>
      <div className="mono tnum text-[15px]" style={{ color: tint ?? 'var(--color-porcelain)' }}>
        {value}
      </div>
    </div>
  )
}
