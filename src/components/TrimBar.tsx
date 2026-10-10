import { useRef, type PointerEvent } from 'react'

interface Props {
  duration: number
  /** [đầu, cuối] của đoạn đang chọn, tính bằng giây. */
  selection: [number, number]
  currentTime: number
  /** Dải ảnh thu nhỏ trải đều theo thời gian, lót bên dưới. */
  thumbnailsUrl?: string
  /** Đoạn chọn ngắn nhất cho phép, tính bằng giây. */
  minLength: number
  onChange(selection: [number, number], moved: 'start' | 'end'): void
  onSeek(seconds: number): void
}

/** Bề rộng tay nắm, tính bằng px. Đủ to để ngón tay bấm trúng trên điện thoại. */
const HANDLE = 18

/**
 * Thanh thời gian kiểu trình dựng phim: dải ảnh của cả video, một khung sáng bao lấy đoạn đang
 * chọn với hai tay nắm để kéo, phần ngoài khung bị làm tối. Chạm vào dải ảnh để tua.
 */
export function TrimBar({ duration, selection, currentTime, thumbnailsUrl, minLength, onChange, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [start, end] = selection
  const percent = (seconds: number) => `${duration > 0 ? (Math.min(Math.max(seconds, 0), duration) / duration) * 100 : 0}%`

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration
  }

  // Giữ con trỏ lại cho tay nắm: kéo trượt ra ngoài thanh vẫn tiếp tục theo ngón tay.
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const drag = (edge: 'start' | 'end') => (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const t = timeAt(event.clientX)
    if (edge === 'start') onChange([Math.min(t, end - minLength), end], 'start')
    else onChange([start, Math.max(t, start + minLength)], 'end')
  }

  const handleClass =
    'trim-handle absolute inset-y-0 z-10 flex cursor-ew-resize touch-none items-center justify-center bg-amber-400'
  const grip = <span className="h-5 w-0.5 rounded bg-black/60" />

  return (
    // Chừa lề hai bên bằng bề rộng tay nắm, để tay nắm ở sát đầu/cuối không bị khuất.
    <div className="trim-bar select-none" style={{ padding: `0 ${HANDLE}px` }}>
      <div
        ref={trackRef}
        className="relative h-14 cursor-pointer rounded-sm bg-panel-2"
        style={thumbnailsUrl ? { backgroundImage: `url("${thumbnailsUrl}")`, backgroundSize: '100% 100%' } : undefined}
        onPointerDown={(event) => onSeek(timeAt(event.clientX))}
      >
        <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: percent(start) }} />
        <div className="absolute inset-y-0 right-0 bg-black/65" style={{ left: percent(end) }} />
        <div
          className="pointer-events-none absolute inset-y-0 border-y-[3px] border-amber-400"
          style={{ left: percent(start), right: `calc(100% - ${percent(end)})` }}
        />
        <div
          className={`${handleClass} rounded-l-md`}
          style={{ left: `calc(${percent(start)} - ${HANDLE}px)`, width: HANDLE }}
          onPointerDown={grab}
          onPointerMove={drag('start')}
        >
          {grip}
        </div>
        <div
          className={`${handleClass} rounded-r-md`}
          style={{ left: percent(end), width: HANDLE }}
          onPointerDown={grab}
          onPointerMove={drag('end')}
        >
          {grip}
        </div>
        <div
          className="trim-playhead pointer-events-none absolute -inset-y-1.5 z-20 -ml-px w-0.5 rounded bg-white shadow"
          style={{ left: percent(currentTime) }}
        />
      </div>
    </div>
  )
}
