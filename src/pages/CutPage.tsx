import { Button, Empty, Modal, Select, Spin, Tooltip } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LuArrowLeftToLine,
  LuArrowRightToLine,
  LuDownload,
  LuPause,
  LuPlay,
  LuRefreshCw,
  LuScissors,
  LuTriangleAlert,
} from 'react-icons/lu'
import { CUT_MAX_MS, type ClipCodec, type ClipInfo } from '../../shared/types'
import { TrimBar } from '../components/TrimBar'
import { useApp } from '../context/AppContext'
import { clipThumbnailsUrl, downloadClip, prepareClip } from '../services/webApi'
import { formatClock, formatDuration } from '../utils/format'

const MINUTE_MS = 60_000
const PRESET_MINUTES = [1, 3, 5, 10, 15, 30]
const DEFAULT_MINUTES = 3
/** Đoạn chọn ngắn nhất, tính bằng giây. */
const MIN_SELECTION = 1

interface Range {
  fromMs: number
  toMs: number
}

type Stage =
  | { kind: 'loading'; text: string }
  | { kind: 'error'; message: string }
  /** `proxied`: đang phát bản xem thử H.264 vì thiết bị không phát được codec gốc. */
  | { kind: 'ready'; window: Range; info: ClipInfo; src: string; proxied: boolean }

/** Giá trị cho <input type="datetime-local"> có cả giây, theo giờ địa phương. */
function toInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const codecLabel = (codec: string) => (codec === 'hevc' ? 'H.265' : codec === 'h264' ? 'H.264' : codec.toUpperCase())
const lastMinutes = (minutes: number): Range => ({ fromMs: Date.now() - minutes * MINUTE_MS, toMs: Date.now() })

/**
 * Trang cắt video, mở bằng điện thoại sau khi quét mã QR trên màn hình kênh. Bố cục kiểu ứng
 * dụng dựng phim: video ở trên, thanh thời gian để kéo chọn đoạn ở dưới, rồi tới chọn khoảng
 * xem lại và nút tải.
 */
export function CutPage({ cameraId }: { cameraId: string }) {
  const { settings } = useApp()
  const camera = settings.cameras.find((c) => c.id === cameraId)

  /** Số phút gần nhất đang xem, hoặc `custom` khi người dùng tự nhập giờ. */
  const [preset, setPreset] = useState<number | 'custom'>(DEFAULT_MINUTES)
  const [custom, setCustom] = useState<Range>(() => lastMinutes(DEFAULT_MINUTES))
  const [customOpen, setCustomOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'loading', text: 'Đang lấy video…' })
  const [duration, setDuration] = useState(0)
  const [selection, setSelection] = useState<[number, number]>([0, 0])
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [downloading, setDownloading] = useState<ClipCodec | null>(null)
  const [downloadError, setDownloadError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  /** Chỉ kết quả của lần tải mới nhất mới được dùng. */
  const loadSeq = useRef(0)
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const load = useCallback(
    async (window: Range) => {
      const seq = ++loadSeq.current
      setStage({ kind: 'loading', text: 'Đang lấy video…' })
      setDownloadError('')
      setPlaying(false)
      try {
        const info = await prepareClip({ cameraId, ...window })
        if (seq !== loadSeq.current) return
        setDuration(info.durationSec)
        setSelection([0, info.durationSec])
        setCurrentTime(0)
        setStage({ kind: 'ready', window, info, src: info.url, proxied: false })
      } catch (err) {
        if (seq === loadSeq.current) setStage({ kind: 'error', message: (err as Error).message })
      }
    },
    [cameraId],
  )

  // Mở trang là có ngay vài phút vừa rồi để xem, khỏi phải bấm gì.
  useEffect(() => {
    void load(lastMinutes(DEFAULT_MINUTES))
  }, [load])

  // Trong lúc phát, cho vạch thời gian chạy mượt theo từng khung hình, và dừng ở cuối đoạn chọn.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const video = videoRef.current
      if (video) {
        const end = selectionRef.current[1]
        if (video.currentTime >= end) {
          video.pause()
          video.currentTime = end
        }
        setCurrentTime(video.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  if (!camera) {
    return (
      <div className="grid h-full place-items-center p-4">
        <Empty description="Không tìm thấy camera này trong kênh. Hãy quét lại mã QR trên màn hình." />
      </div>
    )
  }

  const ready = stage.kind === 'ready'

  const choosePreset = (value: number | 'custom') => {
    if (value === 'custom') return setCustomOpen(true)
    setPreset(value)
    void load(lastMinutes(value))
  }

  const reload = () => void load(preset === 'custom' ? custom : lastMinutes(preset))

  const applyCustom = () => {
    setCustomOpen(false)
    setPreset('custom')
    void load(custom)
  }

  // Thiết bị không phát được codec gốc (thường là H.265): nhờ máy chủ làm bản xem thử H.264.
  const onVideoError = async () => {
    if (stage.kind !== 'ready' || stage.proxied) return
    const { window, info } = stage
    const seq = ++loadSeq.current
    setStage({ kind: 'loading', text: 'Máy này không phát được video gốc, đang tạo bản xem thử…' })
    try {
      const preview = await prepareClip({ cameraId, ...window, preview: true })
      if (seq === loadSeq.current) setStage({ kind: 'ready', window, info, src: preview.url, proxied: true })
    } catch (err) {
      if (seq === loadSeq.current) setStage({ kind: 'error', message: (err as Error).message })
    }
  }

  const onLoadedMetadata = () => {
    const length = videoRef.current?.duration ?? 0
    if (!Number.isFinite(length) || length <= 0) return
    // Độ dài trình phát đo được là chuẩn nhất; giữ nguyên đoạn đã chọn nếu vẫn còn hợp lệ.
    setDuration(length)
    setSelection(([start, end]) => [Math.min(start, length - MIN_SELECTION), Math.min(end, length)])
  }

  const seek = (seconds: number) => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = seconds
    setCurrentTime(seconds)
  }

  const changeSelection = (next: [number, number], moved: 'start' | 'end') => {
    setSelection(next)
    // Kéo đầu nào thì khung hình nhảy theo đầu đó, để thấy mình đang cắt ở đâu.
    seek(moved === 'start' ? next[0] : next[1])
  }

  const markFromPlayhead = (edge: 'start' | 'end') => {
    const [start, end] = selection
    setSelection(
      edge === 'start'
        ? [Math.max(0, Math.min(currentTime, end - MIN_SELECTION)), end]
        : [start, Math.min(duration, Math.max(currentTime, start + MIN_SELECTION))],
    )
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video || !ready) return
    if (!video.paused) return video.pause()
    // Luôn phát bên trong đoạn đã chọn: đang ở ngoài hoặc đã tới cuối thì quay về đầu đoạn.
    const [start, end] = selection
    if (video.currentTime < start || video.currentTime >= end - 0.05) video.currentTime = start
    void video.play().catch(() => {})
  }

  const download = async (codec: ClipCodec) => {
    if (stage.kind !== 'ready') return
    setDownloading(codec)
    setDownloadError('')
    try {
      const whole = selection[0] < 0.2 && duration - selection[1] < 0.2
      const info = await prepareClip({
        cameraId,
        ...stage.window,
        codec,
        ...(whole ? {} : { startSec: selection[0], endSec: selection[1] }),
      })
      downloadClip(info)
    } catch (err) {
      setDownloadError((err as Error).message)
    } finally {
      setDownloading(null)
    }
  }

  const customValid = custom.fromMs < custom.toMs && custom.toMs - custom.fromMs <= CUT_MAX_MS
  const clockAt = (seconds: number) => (ready ? formatClock(stage.window.fromMs + seconds * 1000) : '--:--:--')
  const sourceCodec = ready ? stage.info.sourceCodec : ''
  const inputClass = 'w-full rounded-md border border-line bg-app px-3 py-2 text-base text-white'
  const iconButton = 'flex! h-9! w-9! items-center! justify-center! p-0!'

  return (
    <div className="cut-page flex h-full flex-col bg-black">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2">
        <LuScissors className="text-amber-400" size={18} />
        <span className="font-semibold">Cắt video</span>
        <span className="truncate text-muted">· {camera.name}</span>
      </header>

      <div className="relative min-h-0 flex-1" onClick={togglePlay}>
        {ready && (
          <video
            ref={videoRef}
            className="cut-video h-full w-full object-contain"
            src={stage.src}
            playsInline
            preload="auto"
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={onVideoError}
          />
        )}
        {stage.kind === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-muted">
            <Spin size="large" />
            {stage.text}
          </div>
        )}
        {stage.kind === 'error' && (
          <div className="cut-error absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
            <LuTriangleAlert size={28} className="text-amber-400" />
            {stage.message}
            <span className="text-xs">Thử chọn khoảng thời gian khác ở bên dưới.</span>
          </div>
        )}
        {ready && !playing && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white">
              <LuPlay size={26} />
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 rounded-t-xl bg-panel px-2 pb-3 pt-2">
        <div className="flex items-center justify-between px-2">
          <span className="cut-time w-28 tabular-nums text-muted">
            <span className="text-white">{formatDuration(currentTime * 1000)}</span> / {formatDuration(duration * 1000)}
          </span>
          <Button
            className="cut-play flex! h-10! w-10! items-center! justify-center! p-0!"
            shape="circle"
            type="primary"
            disabled={!ready}
            icon={playing ? <LuPause size={18} /> : <LuPlay size={18} />}
            onClick={togglePlay}
          />
          <div className="flex w-28 justify-end gap-1.5">
            <Tooltip title="Đặt điểm đầu tại vị trí đang xem">
              <Button className={`cut-mark-start ${iconButton}`} disabled={!ready} icon={<LuArrowLeftToLine size={16} />} onClick={() => markFromPlayhead('start')} />
            </Tooltip>
            <Tooltip title="Đặt điểm cuối tại vị trí đang xem">
              <Button className={`cut-mark-end ${iconButton}`} disabled={!ready} icon={<LuArrowRightToLine size={16} />} onClick={() => markFromPlayhead('end')} />
            </Tooltip>
          </div>
        </div>

        <TrimBar
          duration={duration}
          selection={selection}
          currentTime={currentTime}
          thumbnailsUrl={ready ? clipThumbnailsUrl(stage.info) : undefined}
          minLength={MIN_SELECTION}
          onChange={changeSelection}
          onSeek={seek}
        />
        <div className="cut-selection flex items-center justify-between px-5 text-xs tabular-nums text-muted">
          <span>{clockAt(selection[0])}</span>
          <span className="rounded-full bg-amber-400 px-2.5 py-0.5 font-semibold text-black">
            {formatDuration((selection[1] - selection[0]) * 1000)}
          </span>
          <span>{clockAt(selection[1])}</span>
        </div>

        <div className="flex items-center gap-2 px-2">
          <Select<number | 'custom'>
            className="cut-window min-w-0 flex-1"
            size="large"
            value={preset}
            onChange={choosePreset}
            options={[
              ...PRESET_MINUTES.map((minutes) => ({ value: minutes, label: `${minutes} phút gần nhất` })),
              {
                value: 'custom' as const,
                label: preset === 'custom' ? `${formatClock(custom.fromMs)} – ${formatClock(custom.toMs)}` : 'Tự chọn giờ…',
              },
            ]}
          />
          <Tooltip title="Lấy lại tới thời điểm hiện tại">
            <Button className="cut-reload" size="large" icon={<LuRefreshCw />} onClick={reload} />
          </Tooltip>
        </div>

        <div className="flex gap-2 px-2">
          <Button
            className="cut-download-copy flex-1"
            type="primary"
            size="large"
            icon={<LuDownload />}
            loading={downloading === 'copy'}
            disabled={!ready || downloading !== null}
            onClick={() => void download('copy')}
          >
            {ready ? `Tải ${codecLabel(sourceCodec)}` : 'Tải về'}
          </Button>
          {ready && sourceCodec !== 'h264' && (
            <Button
              className="cut-download-h264 flex-1"
              size="large"
              icon={<LuDownload />}
              loading={downloading === 'h264'}
              disabled={downloading !== null}
              onClick={() => void download('h264')}
            >
              Tải H.264
            </Button>
          )}
        </div>
        <div className="cut-hint px-3 text-center text-[11px] leading-snug text-muted">
          {downloadError ? (
            <span className="text-red-400">{downloadError}</span>
          ) : downloading === 'h264' ? (
            'Đang chuyển sang H.264, đoạn càng dài chờ càng lâu…'
          ) : ready && stage.proxied ? (
            `Đang xem bản xem thử vì máy này không phát được ${codecLabel(sourceCodec)}. File tải về vẫn đủ nét.`
          ) : ready && sourceCodec !== 'h264' ? (
            `${codecLabel(sourceCodec)}: bản gốc, nhẹ, có ngay · H.264: máy nào cũng mở được, phải chờ chuyển đổi`
          ) : (
            'Kéo hai tay nắm vàng để chọn đoạn muốn lấy'
          )}
        </div>
      </div>

      <Modal
        open={customOpen}
        title="Tự chọn khoảng thời gian"
        okText="Xem lại"
        okButtonProps={{ disabled: !customValid }}
        onOk={applyCustom}
        onCancel={() => setCustomOpen(false)}
      >
        <div className="flex flex-col gap-3">
          {(['fromMs', 'toMs'] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-muted">{key === 'fromMs' ? 'Từ' : 'Đến'}</span>
              <input
                className={inputClass}
                type="datetime-local"
                step={1}
                value={toInput(custom[key])}
                onChange={(e) => {
                  const ms = new Date(e.target.value).getTime()
                  if (!Number.isNaN(ms)) setCustom((range) => ({ ...range, [key]: ms }))
                }}
              />
            </label>
          ))}
          {!customValid && (
            <span className="text-red-400">
              {custom.fromMs >= custom.toMs
                ? 'Thời điểm “Từ” phải trước thời điểm “Đến”.'
                : `Mỗi lần chỉ lấy được tối đa ${CUT_MAX_MS / MINUTE_MS} phút.`}
            </span>
          )}
        </div>
      </Modal>
    </div>
  )
}
