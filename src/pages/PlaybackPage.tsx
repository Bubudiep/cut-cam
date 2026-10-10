import { App, Button, DatePicker, Empty, Select, Tag, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LuCopy,
  LuFastForward,
  LuFolderOpen,
  LuPause,
  LuPlay,
  LuRefreshCw,
  LuRewind,
  LuSkipBack,
  LuSkipForward,
  LuTrash2,
} from 'react-icons/lu'
import type { RecordingSegment } from '../../shared/types'
import { PageHeader } from '../components/PageHeader'
import { Timeline } from '../components/Timeline'
import { useApp } from '../context/AppContext'
import { isRemote } from '../platform'
import { formatBytes, formatClock, formatDate, formatDuration, startOfDay } from '../utils/format'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const RATES = [0.5, 1, 2, 4, 8]
/** Còn chừng này giây (theo đồng hồ thật, đã tính tốc độ phát) là hết file thì tải sẵn file kế tiếp. */
const PRELOAD_SECONDS = 12

type Slot = 0 | 1

interface Range {
  fromMs: number
  toMs: number
}

const PRESETS: { label: string; range: () => Range }[] = [
  { label: '1 giờ qua', range: () => ({ fromMs: Date.now() - HOUR_MS, toMs: Date.now() }) },
  { label: 'Hôm nay', range: () => ({ fromMs: startOfDay(Date.now()), toMs: startOfDay(Date.now()) + DAY_MS }) },
  { label: 'Hôm qua', range: () => ({ fromMs: startOfDay(Date.now()) - DAY_MS, toMs: startOfDay(Date.now()) }) },
  { label: '7 ngày qua', range: () => ({ fromMs: startOfDay(Date.now()) - 6 * DAY_MS, toMs: startOfDay(Date.now()) + DAY_MS }) },
]

export function PlaybackPage() {
  const { settings } = useApp()
  const { message, modal } = App.useApp()
  const [cameraId, setCameraId] = useState(settings.cameras[0]?.id ?? '')
  const camera = settings.cameras.find((c) => c.id === cameraId) ?? settings.cameras[0]
  const folder = camera?.folder

  const [range, setRange] = useState<Range>(PRESETS[1].range)
  const { fromMs, toMs } = range

  const [segments, setSegments] = useState<RecordingSegment[]>([])
  const [loading, setLoading] = useState(false)
  // Hai trình phát chồng lên nhau: một cái đang chiếu, cái kia tải sẵn file kế tiếp ở phía sau.
  // Hết file thì chỉ việc đổi chỗ hai cái, không phải chờ tải.
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null])
  const [front, setFront] = useState<Slot>(0)
  const back = (1 - front) as Slot
  const activeId = slots[front]
  const [cursorMs, setCursorMs] = useState(fromMs)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)

  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  /** Trình phát đang chiếu. */
  const videoRef = videoRefs[front]
  /** Vị trí cần tua tới ngay khi file kế tiếp tải xong. */
  const pending = useRef<{ offset: number; play: boolean } | null>(null)
  /** Từng trình phát: đang chờ Chromium tính độ dài file (xem onLoadedMetadata). */
  const preparing = useRef<[boolean, boolean]>([false, false])
  /** Từng trình phát: file đã tải xong phần đầu và biết độ dài, tua và phát được ngay. */
  const ready = useRef<[boolean, boolean]>([false, false])

  /** Đưa một file vào một trình phát (null = bỏ trống). */
  const setSlot = (slot: Slot, id: string | null) => {
    setSlots((current) => {
      if (current[slot] === id) return current
      preparing.current[slot] = false
      ready.current[slot] = false
      const next: [string | null, string | null] = [current[0], current[1]]
      next[slot] = id
      return next
    })
  }

  const clearSlots = () => {
    setSlot(0, null)
    setSlot(1, null)
  }

  // Trình phát bị bỏ trống: nhả file đang giữ, kẻo nó tiếp tục tải ngầm.
  const [slot0, slot1] = slots
  useEffect(() => {
    const held = [slot0, slot1]
    held.forEach((id, slot) => {
      const video = videoRefs[slot].current
      if (!id && video && video.networkState !== HTMLMediaElement.NETWORK_EMPTY) {
        video.removeAttribute('src')
        video.load()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot0, slot1])

  const active = segments.find((s) => s.id === activeId) ?? null

  const reload = useCallback(async () => {
    if (!folder) {
      setSegments([])
      return
    }
    setLoading(true)
    try {
      setSegments(await window.cutcam.recordings.list({ cameraFolder: folder, fromMs, toMs }))
    } finally {
      setLoading(false)
    }
  }, [folder, fromMs, toMs])

  // Đổi camera hoặc khoảng thời gian: dừng phát và tải lại danh sách.
  useEffect(() => {
    setSlots([null, null])
    preparing.current = [false, false]
    ready.current = [false, false]
    setPlaying(false)
    setCursorMs(fromMs)
    void reload()
  }, [reload, fromMs])

  useEffect(() => {
    for (const ref of videoRefs) if (ref.current) ref.current.playbackRate = rate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate, slot0, slot1])

  const playSegment = (seg: RecordingSegment, offset: number, play: boolean) => {
    const video = videoRef.current
    setCursorMs(seg.startMs + offset * 1000)
    const standby = videoRefs[back].current
    if (seg.id === activeId && video && video.readyState >= 1 && !preparing.current[front]) {
      video.currentTime = offset
      if (play) void video.play().catch(() => {})
    } else if (seg.id === slots[back] && standby && ready.current[back]) {
      // File này đã được tải sẵn ở trình phát phía sau: đưa nó ra trước, khỏi phải tải lại.
      video?.pause()
      standby.currentTime = offset
      standby.playbackRate = rate
      if (play) void standby.play().catch(() => {})
      else setPlaying(false)
      setSlot(front, null)
      setFront(back)
    } else {
      pending.current = { offset, play }
      setSlot(front, seg.id)
      // Thứ đang tải sẵn là cho file trước đó, giờ không còn dùng tới.
      if (slots[back] !== seg.id) setSlot(back, null)
    }
  }

  const seekTo = (ms: number, play = playing) => {
    const t = Math.min(toMs, Math.max(fromMs, ms))
    // Rơi vào khoảng trống thì nhảy tới đoạn có video kế tiếp.
    const seg = segments.find((s) => t >= s.startMs && t < s.endMs) ?? segments.find((s) => s.startMs > t)
    if (!seg || seg.startMs >= toMs) {
      videoRef.current?.pause()
      setCursorMs(t)
      return
    }
    playSegment(seg, Math.max(0, (t - seg.startMs) / 1000), play)
  }

  const stepSegment = (delta: number) => {
    const index = active ? segments.indexOf(active) + delta : delta > 0 ? 0 : segments.length - 1
    const seg = segments[index]
    if (seg) playSegment(seg, 0, playing)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!active || !video) seekTo(cursorMs >= toMs ? fromMs : cursorMs, true)
    else if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  const applyPending = (video: HTMLVideoElement) => {
    const target = pending.current ?? { offset: 0, play: false }
    pending.current = null
    video.currentTime = target.offset
    if (target.play) void video.play().catch(() => {})
  }

  /** File đã biết độ dài: trình phát đang chiếu thì tua tới chỗ cần xem, trình phát phía sau thì nằm chờ ở đầu file. */
  const settle = (slot: Slot, video: HTMLVideoElement) => {
    ready.current[slot] = true
    if (slot === front) applyPending(video)
    else video.currentTime = 0
  }

  const onLoadedMetadata = (slot: Slot) => {
    const video = videoRefs[slot].current!
    video.playbackRate = rate
    if (Number.isFinite(video.duration)) {
      settle(slot, video)
    } else {
      // Một số file không ghi độ dài trong header, nên Chromium báo duration = Infinity và không
      // cho tua. Tua tới một vị trí rất xa buộc nó đọc tới cuối file và tính ra độ dài thật;
      // sau đó mới tua về vị trí cần xem.
      preparing.current[slot] = true
      video.currentTime = 1e101
    }
  }

  const onDurationChange = (slot: Slot) => {
    const video = videoRefs[slot].current!
    if (!preparing.current[slot] || !Number.isFinite(video.duration)) return
    preparing.current[slot] = false
    settle(slot, video)
  }

  /** File sẽ phát ngay sau file đang chiếu, nếu còn nằm trong khoảng đang xem. */
  const nextSegment = () => {
    const next = active ? segments[segments.indexOf(active) + 1] : undefined
    return next && next.startMs < toMs ? next : undefined
  }

  const onTimeUpdate = (slot: Slot) => {
    const video = videoRefs[slot].current!
    if (slot !== front || preparing.current[slot] || !active) return
    const t = active.startMs + video.currentTime * 1000
    setCursorMs(t)
    if (t >= toMs) return video.pause()
    // Sắp hết file: cho trình phát phía sau tải sẵn file kế tiếp, để lúc chuyển không bị khựng.
    const remaining = (video.duration - video.currentTime) / video.playbackRate
    const next = nextSegment()
    if (next && !video.paused && remaining <= PRELOAD_SECONDS) setSlot(back, next.id)
  }

  const onEnded = (slot: Slot) => {
    const video = videoRefs[slot].current!
    if (slot !== front || preparing.current[slot] || !video.ended || !active) return
    const next = nextSegment()
    // Đã tải sẵn thì `playSegment` chỉ đổi chỗ hai trình phát; chưa kịp thì tải như bình thường.
    if (next) playSegment(next, 0, true)
    else setPlaying(false)
  }

  const removeSegments = (targets: RecordingSegment[]) => {
    const ids = targets.filter((s) => !s.inProgress).map((s) => s.id)
    if (!ids.length) return
    modal.confirm({
      title: ids.length === 1 ? 'Xoá đoạn video này?' : `Xoá ${ids.length} đoạn video trong khoảng đang xem?`,
      content: 'Video bị xoá vĩnh viễn khỏi ổ đĩa.',
      okText: 'Xoá',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (slots.some((id) => id && ids.includes(id))) {
          clearSlots()
          setPlaying(false)
        }
        const removed = await window.cutcam.recordings.remove(ids)
        message.success(`Đã xoá ${removed} đoạn video`)
        await reload()
      },
    })
  }

  const exportSegments = async () => {
    const copied = await window.cutcam.recordings.exportTo(segments.map((s) => s.id))
    if (copied !== null) message.success(`Đã chép ${copied} file`)
  }

  const totalMs = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0)
  const totalBytes = segments.reduce((sum, s) => sum + s.sizeBytes, 0)
  const hasSegments = segments.length > 0

  if (!camera) {
    return (
      <div className="grid h-full place-items-center">
        <Empty description="Chưa có camera nào. Thêm camera và ghi hình trước, sau đó quay lại đây để xem lại." />
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col gap-3 p-5">
      <PageHeader
        title="Xem lại"
        subtitle={loading ? 'Đang tải…' : `${segments.length} đoạn · ${formatDuration(totalMs)} · ${formatBytes(totalBytes)}`}
      >
        <Button icon={<LuRefreshCw />} onClick={() => void reload()}>
          Làm mới
        </Button>
        {!isRemote && (
          <>
            <Button icon={<LuCopy />} onClick={exportSegments} disabled={!hasSegments}>
              Chép ra thư mục…
            </Button>
            <Button danger icon={<LuTrash2 />} onClick={() => removeSegments(segments)} disabled={!hasSegments}>
              Xoá khoảng này
            </Button>
          </>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="camera-select min-w-40"
          value={camera.id}
          onChange={setCameraId}
          options={settings.cameras.map((c) => ({ value: c.id, label: c.name }))}
        />
        <DatePicker.RangePicker
          showTime={{ format: 'HH:mm' }}
          format="DD/MM/YYYY HH:mm"
          allowClear={false}
          value={[dayjs(fromMs), dayjs(toMs)]}
          onChange={(values) => {
            if (values?.[0] && values[1]) setRange({ fromMs: values[0].valueOf(), toMs: values[1].valueOf() })
          }}
        />
        {PRESETS.map((preset) => (
          <Button key={preset.label} size="small" onClick={() => setRange(preset.range())}>
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-3">
        <div className="player flex min-w-0 flex-col gap-2">
          <div className="relative aspect-video max-h-[58vh] overflow-hidden rounded-lg bg-black">
            {([0, 1] as const).map((slot) => (
              <video
                key={slot}
                ref={videoRefs[slot]}
                // Trình phát phía sau vẫn nằm đó để tải sẵn, chỉ là không hiện ra.
                className={`playback-video absolute inset-0 h-full w-full object-contain ${slot === front ? '' : 'invisible'}`}
                data-front={slot === front}
                src={segments.find((s) => s.id === slots[slot])?.url}
                preload="auto"
                onLoadedMetadata={() => onLoadedMetadata(slot)}
                onDurationChange={() => onDurationChange(slot)}
                onTimeUpdate={() => onTimeUpdate(slot)}
                onEnded={() => onEnded(slot)}
                onPlay={() => slot === front && setPlaying(true)}
                onPause={() => slot === front && setPlaying(false)}
                onClick={togglePlay}
              />
            ))}
            {!active && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center text-muted">
                {hasSegments ? 'Bấm phát hoặc chọn một điểm trên thanh thời gian' : 'Không có video trong khoảng này'}
              </div>
            )}
          </div>

          <Timeline fromMs={fromMs} toMs={toMs} segments={segments} cursorMs={cursorMs} onSeek={(ms) => seekTo(ms)} />

          <div className="flex flex-wrap items-center gap-1.5">
            <Tooltip title="Đoạn trước">
              <Button icon={<LuSkipBack />} onClick={() => stepSegment(-1)} disabled={!hasSegments} />
            </Tooltip>
            <Tooltip title="Lùi 10 giây">
              <Button icon={<LuRewind />} onClick={() => seekTo(cursorMs - 10_000)} disabled={!hasSegments} />
            </Tooltip>
            <Button
              type="primary"
              className="play-button min-w-24"
              icon={playing ? <LuPause /> : <LuPlay />}
              onClick={togglePlay}
              disabled={!hasSegments}
            >
              {playing ? 'Tạm dừng' : 'Phát'}
            </Button>
            <Tooltip title="Tới 10 giây">
              <Button icon={<LuFastForward />} onClick={() => seekTo(cursorMs + 10_000)} disabled={!hasSegments} />
            </Tooltip>
            <Tooltip title="Đoạn sau">
              <Button icon={<LuSkipForward />} onClick={() => stepSegment(1)} disabled={!hasSegments} />
            </Tooltip>
            <span className="playback-clock ml-2 mr-auto tabular-nums">
              {formatDate(cursorMs)} {formatClock(cursorMs)}
            </span>
            <span className="text-muted">Tốc độ</span>
            <Select value={rate} onChange={setRate} options={RATES.map((r) => ({ value: r, label: `${r}x` }))} />
          </div>
        </div>

        <aside className="flex max-h-[calc(100vh-170px)] flex-col gap-1.5 overflow-y-auto pr-1">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className={`segment-item flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 tabular-nums hover:border-muted ${
                seg.id === activeId ? 'border-accent bg-panel-2' : 'border-line bg-panel'
              }`}
              onClick={() => playSegment(seg, 0, true)}
            >
              <div className="min-w-0">
                <div className="font-semibold">
                  {formatClock(seg.startMs)} – {formatClock(seg.endMs)}
                </div>
                <div className="text-[11px] text-muted">
                  {formatDate(seg.startMs)} · {formatDuration(seg.endMs - seg.startMs)} · {formatBytes(seg.sizeBytes)}
                </div>
              </div>
              {seg.inProgress && <Tag color="red">đang ghi</Tag>}
              {!isRemote && (
                <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Mở vị trí file">
                    <Button size="small" type="text" icon={<LuFolderOpen />} onClick={() => window.cutcam.recordings.reveal(seg.id)} />
                  </Tooltip>
                  <Tooltip title="Xoá">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<LuTrash2 />}
                      disabled={seg.inProgress}
                      onClick={() => removeSegments([seg])}
                    />
                  </Tooltip>
                </div>
              )}
            </div>
          ))}
          {!hasSegments && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có video" />}
        </aside>
      </div>
    </div>
  )
}
