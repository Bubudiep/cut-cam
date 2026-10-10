import { useRef, useState, type MouseEvent } from 'react'
import type { RecordingSegment } from '../../shared/types'
import { formatClock, formatDate } from '../utils/format'

interface Props {
  fromMs: number
  toMs: number
  segments: RecordingSegment[]
  cursorMs: number
  onSeek(ms: number): void
}

const TICKS = 6
const DAY_MS = 24 * 60 * 60 * 1000

/** Thanh thời gian của khoảng đang xem: các đoạn có video được tô màu, bấm vào để tua. */
export function Timeline({ fromMs, toMs, segments, cursorMs, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const span = toMs - fromMs
  const percent = (ms: number) => Math.min(100, Math.max(0, ((ms - fromMs) / span) * 100))
  const label = (ms: number) =>
    span > DAY_MS ? `${formatDate(ms).slice(0, 5)} ${formatClock(ms, false)}` : formatClock(ms, false)

  const timeAt = (event: MouseEvent) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    return fromMs + ratio * span
  }

  return (
    <div>
      <div
        ref={trackRef}
        className="relative h-8 cursor-pointer rounded-md border border-line bg-panel"
        onClick={(e) => onSeek(timeAt(e))}
        onMouseMove={(e) => setHover(timeAt(e))}
        onMouseLeave={() => setHover(null)}
      >
        {segments.map((seg) => {
          const left = percent(seg.startMs)
          return (
            <div
              key={seg.id}
              className={`absolute inset-y-1.5 min-w-0.5 rounded-sm opacity-85 ${seg.inProgress ? 'bg-red-500' : 'bg-accent'}`}
              style={{ left: `${left}%`, width: `${Math.max(percent(seg.endMs) - left, 0.15)}%` }}
            />
          )
        })}
        <div className="pointer-events-none absolute -inset-y-1 -ml-px w-0.5 bg-white" style={{ left: `${percent(cursorMs)}%` }} />
        {hover !== null && (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-muted" style={{ left: `${percent(hover)}%` }}>
            <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-panel-2 px-1.5 py-0.5 text-xs tabular-nums">
              {formatClock(hover)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted">
        {Array.from({ length: TICKS + 1 }, (_, i) => (
          <span key={i}>{label(fromMs + (span * i) / TICKS)}</span>
        ))}
      </div>
    </div>
  )
}
