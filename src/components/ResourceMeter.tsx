interface MeterProps {
  label: string
  value: number
  max: number
  displayValue: string
  burnoutAt?: number // 0-1 position for projection hairline
}

export function ResourceMeter({ label, value, max, displayValue, burnoutAt }: MeterProps) {
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const color = pct >= 0.95 ? 'var(--color-flare)' : pct >= 0.8 ? 'var(--color-sodium)' : 'var(--color-iris)'

  return (
    <div className="flex flex-col gap-1.5">
      <span className="signage text-ash">{label}</span>
      <span className="mono tnum text-[20px] leading-6 text-porcelain">{displayValue}</span>
      <div className="relative h-1 w-full" style={{ background: 'var(--color-rule)' }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct * 100}%`, background: color }} />
        {burnoutAt !== undefined && (
          <div
            className="absolute top-[-2px] h-2 w-px"
            style={{ left: `${Math.min(100, burnoutAt * 100)}%`, background: 'var(--color-ash)' }}
            title="projected burn-out point"
          />
        )}
      </div>
    </div>
  )
}
