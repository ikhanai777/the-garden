import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATE_META } from '../data/stateMeta'
import { useAppState } from '../hooks/useAppState'
import { sortByUrgency, useFleet } from '../hooks/useFleet'
import type { Agent, AgentState, Tick } from '../types'
import { formatDuration, formatElapsed, formatTokens } from '../utils/format'

const PX_PER_TICK = 1
const TICK_MS = 250
const MS_PER_PX = TICK_MS / PX_PER_TICK
const LANE_H_MAX = 18 // 14px lane + 4px gutter
const LANE_H_MIN = 11
const LABEL_W = 116
const FADE_W = 40

function tickBarHeight(t: Tick): number {
  if (!t.duration) return 1
  const clamped = Math.min(3000, Math.max(50, t.duration))
  const frac = Math.log(clamped / 50) / Math.log(3000 / 50)
  return 2 + frac * 10
}

interface Segment {
  state: AgentState
  fromT: number
  toT: number
}

/** Reconstruct a coarse state timeline from embedded tick markers. */
function segmentsFor(agent: Agent): Segment[] {
  const segs: Segment[] = []
  const hasMarker = agent.ticks.some((t) => t.marker)
  let curState: AgentState = hasMarker ? 'running' : agent.state
  let curStart = agent.ticks[0]?.t ?? agent.spawnedAt
  for (const t of agent.ticks) {
    if (t.marker) {
      segs.push({ state: curState, fromT: curStart, toT: t.t })
      curState =
        t.marker === 'waiting-start'
          ? 'waiting'
          : t.marker === 'failed'
            ? 'failed'
            : t.marker === 'complete'
              ? 'complete'
              : t.marker === 'halted'
                ? 'halted'
                : t.marker === 'blocked-start'
                  ? 'blocked'
                  : 'running'
      curStart = t.t
    }
  }
  const lastT = agent.ticks[agent.ticks.length - 1]?.t ?? curStart
  segs.push({ state: curState, fromT: curStart, toT: lastT })
  return segs
}

interface HoverInfo {
  x: number
  y: number
  agentName: string
  toolName?: string
  duration?: number
  tokenCost?: number
}

export function Tide() {
  const agents = useFleet()
  const { select, replayTime, setReplayTime } = useAppState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const sorted = sortByUrgency(agents)
  const laneH = Math.min(LANE_H_MAX, Math.max(LANE_H_MIN, 72 / Math.max(1, sorted.length)))

  const draw = useCallback(
    (nowRender: number, isReplay: boolean) => {
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap) return
      const cssW = wrap.clientWidth - LABEL_W
      const cssH = Math.max(72, sorted.length * laneH)
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        canvas.style.width = `${cssW}px`
        canvas.style.height = `${cssH}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      // minute gridlines
      ctx.font = '10px "IBM Plex Mono", monospace'
      ctx.fillStyle = '#4d556b'
      ctx.textAlign = 'right'
      for (let m = 1; m <= 10; m++) {
        const x = cssW - (m * 60000) / MS_PER_PX
        if (x < 0) break
        ctx.fillRect(x, 0, 1, cssH)
        ctx.fillText(`-${m}m`, x - 3, 9)
      }

      sorted.forEach((agent, i) => {
        const y0 = i * laneH
        const midY = y0 + laneH / 2
        const baseline = y0 + laneH - 2
        const dim = agent.state === 'complete' || agent.state === 'halted'
        ctx.globalAlpha = dim ? 0.3 : 1

        // lane baseline rule
        ctx.fillStyle = '#232a3a'
        ctx.fillRect(0, baseline, cssW, 1)

        const segs = segmentsFor(agent)

        for (const seg of segs) {
          const segEndX = cssW - (nowRender - seg.toT) / MS_PER_PX
          const segStartX = cssW - (nowRender - seg.fromT) / MS_PER_PX
          if (segEndX < 0) continue

          if (seg.state === 'waiting') {
            const x0 = Math.max(0, segStartX)
            ctx.strokeStyle = STATE_META.waiting.color
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x0, baseline - 3)
            ctx.lineTo(cssW, baseline - 3)
            ctx.moveTo(x0, baseline + 1)
            ctx.lineTo(cssW, baseline + 1)
            ctx.stroke()
            if (segStartX >= 0 && segStartX <= cssW) {
              ctx.fillStyle = STATE_META.waiting.color
              ctx.font = 'bold 9px monospace'
              ctx.textAlign = 'center'
              ctx.fillText('◆', segStartX, midY + 3)
            }
            if (agent.state === 'waiting') {
              ctx.fillStyle = STATE_META.waiting.color
              ctx.font = '9px "IBM Plex Mono", monospace'
              ctx.textAlign = 'right'
              ctx.fillText(
                `WAITING ${formatElapsed(nowRender - agent.stateSince)}`,
                cssW - 4,
                midY + 3,
              )
            }
          } else if (seg.state === 'blocked' || seg.state === 'spawning') {
            ctx.strokeStyle = '#4d556b'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(Math.max(0, segStartX), baseline - 1)
            ctx.lineTo(Math.min(cssW, segEndX), baseline - 1)
            ctx.stroke()
          } else if (seg.state === 'running') {
            for (const t of agent.ticks) {
              if (t.t < seg.fromT || t.t > seg.toT) continue
              const x = cssW - (nowRender - t.t) / MS_PER_PX
              if (x < 0 || x > cssW) continue
              const h = tickBarHeight(t)
              ctx.fillStyle = STATE_META.running.color
              ctx.fillRect(x, baseline - h, 1, h)
            }
          } else if (seg.state === 'failed') {
            const x = Math.min(cssW, Math.max(0, segEndX))
            ctx.strokeStyle = STATE_META.failed.color
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(x - 3, baseline - 4)
            ctx.lineTo(x + 3, baseline + 4)
            ctx.moveTo(x + 3, baseline - 4)
            ctx.lineTo(x - 3, baseline + 4)
            ctx.stroke()
            if (agent.state === 'failed') {
              ctx.fillStyle = STATE_META.failed.color
              ctx.font = '9px "IBM Plex Mono", monospace'
              ctx.textAlign = 'right'
              ctx.fillText('FAILED', cssW - 4, midY + 3)
            }
          } else if (seg.state === 'complete') {
            const x = Math.min(cssW, Math.max(0, segEndX))
            ctx.fillStyle = STATE_META.complete.color
            ctx.beginPath()
            ctx.arc(x, baseline - 2, 2.5, 0, Math.PI * 2)
            ctx.fill()
          } else if (seg.state === 'halted') {
            const x = Math.min(cssW, Math.max(0, segEndX))
            ctx.strokeStyle = STATE_META.halted.color
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.moveTo(x, baseline - 6)
            ctx.lineTo(x, baseline + 2)
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
      })

      // replay cursor
      if (isReplay) {
        ctx.strokeStyle = '#ffb020'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cssW - 0.5, 0)
        ctx.lineTo(cssW - 0.5, cssH)
        ctx.stroke()
      }
    },
    [sorted, laneH],
  )

  useEffect(() => {
    let raf = 0
    const loop = () => {
      draw(replayTime ?? Date.now(), replayTime !== null)
      if (!reducedMotion) {
        raf = requestAnimationFrame(loop)
      }
    }
    if (reducedMotion) {
      draw(replayTime ?? Date.now(), replayTime !== null)
      const id = setInterval(() => draw(replayTime ?? Date.now(), replayTime !== null), 1000)
      return () => clearInterval(id)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw, replayTime, reducedMotion])

  useEffect(() => {
    const onResize = () => draw(replayTime ?? Date.now(), replayTime !== null)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [draw, replayTime])

  useEffect(() => {
    if (!scrubbing) return
    const onUp = () => setScrubbing(false)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [scrubbing])

  const xToTime = (offsetX: number) => {
    const canvas = canvasRef.current
    if (!canvas) return Date.now()
    const cssW = canvas.getBoundingClientRect().width
    const nowRender = replayTime ?? Date.now()
    return nowRender - (cssW - offsetX) * MS_PER_PX
  }

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const laneIdx = Math.floor(y / laneH)
    const agent = sorted[laneIdx]
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (!agent) {
      setHover(null)
      return
    }
    if (scrubbing) {
      setReplayTime(xToTime(x))
      return
    }
    const t = xToTime(x)
    const nearest = agent.ticks
      .filter((tk) => tk.duration)
      .reduce<Tick | null>((best, tk) => {
        if (!best) return tk
        return Math.abs(tk.t - t) < Math.abs(best.t - t) ? tk : best
      }, null)
    hoverTimer.current = setTimeout(() => {
      if (nearest && Math.abs(nearest.t - t) < MS_PER_PX * 6) {
        setHover({
          x: e.clientX,
          y: e.clientY,
          agentName: agent.name,
          toolName: nearest.toolName,
          duration: nearest.duration,
          tokenCost: nearest.tokenCost,
        })
      } else {
        setHover(null)
      }
    }, 80)
  }

  const handleLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHover(null)
    setScrubbing(false)
  }

  const handleDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const y = e.clientY - rect.top
    const laneIdx = Math.floor(y / laneH)
    const agent = sorted[laneIdx]
    setScrubbing(true)
    setReplayTime(xToTime(e.clientX - rect.left))
    if (agent) select(agent.id)
  }

  const handleUp = () => setScrubbing(false)

  return (
    <div
      ref={wrapRef}
      className="relative flex h-12 shrink-0 overflow-y-auto border-t lg:h-[72px]"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-void)' }}
    >
      <div className="flex shrink-0 flex-col border-r" style={{ width: LABEL_W, borderColor: 'var(--color-rule)' }}>
        {sorted.map((agent) => {
          const meta = STATE_META[agent.state]
          const dim = agent.state === 'complete' || agent.state === 'halted'
          return (
            <button
              key={agent.id}
              onClick={() => select(agent.id)}
              className="flex shrink-0 items-center gap-1.5 px-2 text-left"
              style={{ height: laneH, opacity: dim ? 0.3 : 1 }}
              title={agent.name}
            >
              <span className="mono shrink-0 text-[9px]" style={{ color: meta.color }}>
                {meta.glyph}
              </span>
              <span className="mono truncate text-[10px] text-ash">{agent.name}</span>
            </button>
          )
        })}
      </div>

      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          className="block cursor-crosshair"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          onMouseDown={handleDown}
          onMouseUp={handleUp}
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ width: FADE_W, background: 'linear-gradient(90deg, var(--color-void), transparent)' }}
        />
      </div>

      {hover && (
        <div
          className="mono pointer-events-none fixed z-50 flex flex-col gap-0.5 border px-2 py-1.5 text-[11px]"
          style={{
            left: hover.x + 12,
            top: hover.y - 48,
            background: 'var(--color-slab)',
            borderColor: 'var(--color-rule)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <span className="text-porcelain">{hover.agentName}</span>
          {hover.toolName && <span className="text-ash">{hover.toolName}</span>}
          {hover.duration !== undefined && (
            <span className="tnum text-ash">
              {formatDuration(hover.duration)} · {formatTokens(hover.tokenCost ?? 0)} tok
            </span>
          )}
        </div>
      )}
    </div>
  )
}
