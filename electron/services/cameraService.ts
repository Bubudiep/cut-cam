import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { IPC } from '../../shared/ipc'
import type { AppSettings, CameraConfig, CameraStatusMap, PreviewState, RecorderState } from '../../shared/types'
import { cameraInputArgs, ffmpegPath, recordVideoArgs, redact } from './ffmpeg'
import { findIpByMac } from './network/scan'
import * as recordings from './recordingStore'
import { getSettings, updateSettings } from './settingsStore'

// Mỗi camera có tối đa hai tiến trình ffmpeg:
//  - recorder: chép nguyên luồng chính xuống đĩa (không mã hoá lại nên rất nhẹ CPU),
//    sống độc lập với giao diện;
//  - preview: giải mã luồng phụ thành các khung JPEG để hiển thị, chỉ chạy khi có ô xem trực tiếp.

const RETRY_DELAY_MS = 5000
const STOP_GRACE_MS = 4000
/** Quét cả mạng để tìm lại camera theo MAC là việc nặng: mỗi camera tối đa một lần trong khoảng này. */
const MAC_LOOKUP_INTERVAL_MS = 2 * 60 * 1000
/**
 * Hình xem trực tiếp. `standard` lấy luồng phụ của camera, nhẹ máy, hợp với lưới nhiều camera.
 * `high` lấy luồng chính cho hình nét và mượt hơn, hợp với màn hình lớn chiếu toàn màn hình,
 * đổi lại máy chủ tốn CPU hơn rõ rệt cho mỗi camera đang có người xem.
 */
const PREVIEW_PROFILES = {
  standard: { stream: 'sub', fps: 8, width: 640, jpegQuality: '6' },
  high: { stream: 'main', fps: 15, width: 1280, jpegQuality: '5' },
} as const
const JPEG_END = Buffer.from([0xff, 0xd9])

interface Recorder {
  proc: ChildProcessWithoutNullStreams
  key: string
  currentFile?: string
  lastLine: string
  stopping: boolean
}

interface Preview {
  proc: ChildProcessWithoutNullStreams
  key: string
  lastLine: string
  stopping: boolean
}

interface Runtime {
  wantRecording: boolean
  recorder?: Recorder
  recorderState: RecorderState
  recorderError?: string
  recordingSince?: number
  recorderRetry?: NodeJS.Timeout
  lastMacLookup: number

  /** Cửa sổ của chính app này đang hiển thị camera. */
  localPreview: boolean
  /** Số máy trạm đang xem camera qua web. */
  remoteViewers: number
  lastFrame?: Buffer
  preview?: Preview
  previewState: PreviewState
  previewError?: string
  previewRetry?: NodeJS.Timeout
}

type Emit = (channel: string, ...args: unknown[]) => void

const runtimes = new Map<string, Runtime>()
let emit: Emit = () => {}
let firstSync = true
/** Cửa sổ đang ẩn dưới khay: không ai xem nên không giải mã luồng xem trực tiếp. */
let previewsSuspended = false
let shuttingDown = false

type FrameListener = (jpeg: Buffer) => void
/** Các máy trạm đang nhận khung hình, theo từng camera. */
const frameListeners = new Map<string, Set<FrameListener>>()

/** Luồng xem trực tiếp chỉ chạy khi có người xem: cửa sổ app đang hiện, hoặc có máy trạm kết nối. */
const previewWanted = (rt: Runtime) =>
  !shuttingDown && ((rt.localPreview && !previewsSuspended) || rt.remoteViewers > 0)

export function setEmitter(fn: Emit) {
  emit = fn
}

const findCamera = (id: string) => getSettings().cameras.find((c) => c.id === id && c.enabled)

function runtimeOf(id: string): Runtime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = { wantRecording: false, recorderState: 'idle', lastMacLookup: 0, localPreview: false, remoteViewers: 0, previewState: 'off' }
    runtimes.set(id, rt)
  }
  return rt
}

export function status(): CameraStatusMap {
  const map: CameraStatusMap = {}
  for (const [id, rt] of runtimes) {
    map[id] = {
      recording: rt.wantRecording,
      recorder: rt.recorderState,
      recorderError: rt.recorderError,
      recordingSince: rt.recordingSince,
      preview: rt.previewState,
      previewError: rt.previewError,
    }
  }
  return map
}

const publish = () => emit(IPC.camStatusChanged, status())

function describeFailure(lastLine: string): string {
  const line = redact(lastLine)
  if (/401|Unauthorized/i.test(line)) return 'Sai tên đăng nhập hoặc mật khẩu'
  if (/404|Not Found/i.test(line)) return 'Sai đường dẫn luồng RTSP'
  if (/timed out|Connection refused|No route|unreachable|Error number -138|10060|10061/i.test(line)) {
    return 'Không kết nối được tới camera'
  }
  return line || 'Mất kết nối camera'
}

function waitForExit(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => proc.once('exit', () => resolve()))
}

function pipeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  let rest = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    const lines = (rest + chunk).split(/\r?\n|\r/)
    rest = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onLine(line.trim())
  })
}

// ---------------------------------------------------------------- recorder

const recorderKey = (camera: CameraConfig, settings: AppSettings) =>
  JSON.stringify([
    camera.test,
    camera.host,
    camera.rtspPort,
    camera.username,
    camera.password,
    camera.mainPath,
    camera.transport,
    camera.recordAudio,
    camera.folder,
    settings.storageDir,
    settings.segmentMinutes,
  ])

/**
 * Camera đang phát H.265. File MP4 chứa H.265 phải gắn nhãn `hvc1` thì iPhone, Safari và
 * QuickTime mới chịu phát; mặc định ffmpeg gắn `hev1`. Nhãn này lại không hợp lệ với H.264, mà
 * ta chỉ biết codec khi ffmpeg đã nối được vào camera, nên: lần đầu chạy không nhãn, thấy H.265
 * thì ghi vào đây và chạy lại.
 */
const hevcCameras = new Set<string>()

function spawnRecorder(camera: CameraConfig, rt: Runtime) {
  const settings = getSettings()
  clearTimeout(rt.recorderRetry)
  rt.recorderState = 'connecting'
  rt.recorderError = undefined

  try {
    recordings.ensureDayDirs(settings.storageDir, camera.folder)
  } catch (err) {
    rt.recorderState = 'error'
    rt.recorderError = `Không ghi được vào thư mục lưu trữ: ${(err as Error).message}`
    rt.recorderRetry = setTimeout(() => retryRecorder(camera.id), RETRY_DELAY_MS)
    return
  }

  // ffmpeg coi `%` là mã strftime nên phải nhân đôi các dấu `%` có sẵn trong đường dẫn.
  const cameraDir = path.join(settings.storageDir, camera.folder).replace(/\\/g, '/').replace(/%/g, '%%')
  const args = [
    '-loglevel',
    'info',
    ...cameraInputArgs(camera, 'main'),
    '-map',
    '0:v:0',
    // Âm thanh camera thường là G.711, không nằm được trong MP4: chuyển sang AAC.
    ...(camera.recordAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '64k'] : ['-an']),
    ...recordVideoArgs(camera),
    ...(hevcCameras.has(camera.id) ? ['-tag:v', 'hvc1'] : []),
    '-f',
    'segment',
    '-segment_time',
    String(settings.segmentMinutes * 60),
    // Cắt file đúng mốc giờ đồng hồ (vd. 5 phút: :00, :05, :10...) cho dễ tìm.
    '-segment_atclocktime',
    '1',
    '-reset_timestamps',
    '1',
    '-strftime',
    '1',
    '-segment_format',
    'mp4',
    // MP4 phân mảnh: file vẫn phát được dù ffmpeg bị tắt giữa chừng.
    '-segment_format_options',
    'movflags=+frag_keyframe+empty_moov+default_base_moof',
    `${cameraDir}/%Y-%m-%d/%H-%M-%S.rec.mp4`,
  ]
  const proc = spawn(ffmpegPath, args, { windowsHide: true })
  const recorder: Recorder = { proc, key: recorderKey(camera, settings), lastLine: '', stopping: false }
  rt.recorder = recorder

  const closeCurrentFile = () => {
    if (recorder.currentFile) recordings.finalizeFile(recorder.currentFile, Date.now())
    recorder.currentFile = undefined
  }

  pipeLines(proc.stderr, (line) => {
    // ffmpeg in dòng này mỗi khi mở file kế tiếp, tức là file trước đó đã đóng xong.
    const opened = /Opening '(.+)' for writing/.exec(line)?.[1]
    if (!opened) {
      recorder.lastLine = line
      // ffmpeg vừa cho biết codec của camera khác với điều ta đang giả định: ghi nhớ rồi chạy lại
      // ngay với tham số đúng (handler `exit` tự chạy lại vì `stopping` đang bật).
      const isHevc = /Stream #0:\d+.*Video: hevc/.test(line)
      const tagRejected = /Tag hvc1 incompatible/.test(line)
      if ((isHevc && !hevcCameras.has(camera.id)) || (tagRejected && hevcCameras.has(camera.id))) {
        if (isHevc) hevcCameras.add(camera.id)
        else hevcCameras.delete(camera.id)
        recorder.stopping = true
        proc.kill()
      }
      return
    }
    closeCurrentFile()
    recorder.currentFile = opened
    recordings.markActive(opened)
    recordings.ensureDayDirs(getSettings().storageDir, camera.folder)
    rt.recorderState = 'recording'
    rt.recorderError = undefined
    rt.recordingSince ??= Date.now()
    publish()
  })
  proc.on('error', (err) => (recorder.lastLine = err.message))
  proc.on('exit', () => {
    closeCurrentFile()
    if (rt.recorder !== recorder) return
    rt.recorder = undefined
    rt.recordingSince = undefined
    const current = findCamera(camera.id)
    if (!rt.wantRecording || !current) {
      rt.recorderState = 'idle'
    } else if (recorder.stopping) {
      // Bị dừng để đổi cấu hình, hoặc người dùng bật lại ngay trong lúc đang dừng.
      spawnRecorder(current, rt)
    } else {
      rt.recorderState = 'error'
      rt.recorderError = describeFailure(recorder.lastLine)
      rt.recorderRetry = setTimeout(() => retryRecorder(camera.id), RETRY_DELAY_MS)
    }
    publish()
  })
}

/** Camera dùng DHCP có thể đã đổi IP: tìm lại theo MAC rồi cập nhật cài đặt. */
async function relocateByMac(camera: CameraConfig, rt: Runtime): Promise<boolean> {
  if (!camera.mac || Date.now() - rt.lastMacLookup < MAC_LOOKUP_INTERVAL_MS) return false
  rt.lastMacLookup = Date.now()
  const ip = await findIpByMac(camera.mac, true)
  if (!ip || ip === camera.host) return false
  const cameras = getSettings().cameras.map((c) => (c.id === camera.id ? { ...c, host: ip } : c))
  emit(IPC.settingsChanged, updateSettings({ cameras }))
  return true
}

async function retryRecorder(id: string) {
  const rt = runtimes.get(id)
  let camera = findCamera(id)
  if (!rt || !camera || !rt.wantRecording || rt.recorder) return
  if (await relocateByMac(camera, rt)) camera = findCamera(id)
  if (camera && rt.wantRecording && !rt.recorder) spawnRecorder(camera, rt)
  publish()
}

async function killRecorder(rt: Runtime) {
  clearTimeout(rt.recorderRetry)
  const recorder = rt.recorder
  if (!recorder) return
  recorder.stopping = true
  // Gửi "q" để ffmpeg tự đóng file cho tử tế; không chịu thoát thì mới ép.
  try {
    recorder.proc.stdin.write('q')
  } catch {
    // Tiến trình đã chết.
  }
  const timer = setTimeout(() => recorder.proc.kill(), STOP_GRACE_MS)
  await waitForExit(recorder.proc)
  clearTimeout(timer)
}

export function startRecording(id: string) {
  const camera = findCamera(id)
  if (!camera) return
  const rt = runtimeOf(id)
  rt.wantRecording = true
  if (!rt.recorder) spawnRecorder(camera, rt)
  publish()
}

export async function stopRecording(id: string) {
  const rt = runtimes.get(id)
  if (!rt) return
  rt.wantRecording = false
  await killRecorder(rt)
  if (!rt.recorder && !rt.wantRecording) {
    rt.recorderState = 'idle'
    rt.recorderError = undefined
  }
  publish()
}

export function startAll() {
  for (const camera of getSettings().cameras) if (camera.enabled) startRecording(camera.id)
}

export async function stopAll() {
  await Promise.all([...runtimes.keys()].map(stopRecording))
}

// ---------------------------------------------------------------- preview

const previewKey = (camera: CameraConfig) =>
  JSON.stringify([
    camera.test,
    camera.host,
    camera.rtspPort,
    camera.username,
    camera.password,
    camera.subPath,
    camera.mainPath,
    camera.transport,
    getSettings().previewQuality,
  ])

function spawnPreview(camera: CameraConfig, rt: Runtime) {
  clearTimeout(rt.previewRetry)
  if (!previewWanted(rt)) {
    rt.previewState = 'off'
    return
  }
  rt.previewState = 'connecting'
  rt.previewError = undefined

  const profile = PREVIEW_PROFILES[getSettings().previewQuality]
  const args = [
    '-loglevel',
    'error',
    '-fflags',
    'nobuffer',
    '-flags',
    'low_delay',
    ...cameraInputArgs(camera, profile.stream),
    '-an',
    '-vf',
    `fps=${profile.fps},scale=${profile.width}:-2`,
    '-q:v',
    profile.jpegQuality,
    '-f',
    'mjpeg',
    'pipe:1',
  ]
  const proc = spawn(ffmpegPath, args, { windowsHide: true })
  const preview: Preview = { proc, key: previewKey(camera), lastLine: '', stopping: false }
  rt.preview = preview

  // Luồng MJPEG là các ảnh JPEG nối đuôi nhau; mỗi ảnh kết thúc bằng FF D9.
  let pending: Buffer = Buffer.alloc(0)
  let searchFrom = 0
  proc.stdout.on('data', (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    for (;;) {
      const end = pending.indexOf(JPEG_END, searchFrom)
      if (end < 0) {
        searchFrom = Math.max(0, pending.length - 1)
        break
      }
      const frame = pending.subarray(0, end + 2)
      rt.lastFrame = frame
      if (rt.localPreview && !previewsSuspended) emit(IPC.camFrame, camera.id, frame)
      frameListeners.get(camera.id)?.forEach((listener) => listener(frame))
      pending = pending.subarray(end + 2)
      searchFrom = 0
      if (rt.previewState !== 'live') {
        rt.previewState = 'live'
        publish()
      }
    }
  })
  pipeLines(proc.stderr, (line) => (preview.lastLine = line))
  proc.on('error', (err) => (preview.lastLine = err.message))
  proc.on('exit', () => {
    if (rt.preview !== preview) return
    rt.preview = undefined
    rt.lastFrame = undefined
    const current = findCamera(camera.id)
    if (!previewWanted(rt) || !current) {
      rt.previewState = 'off'
    } else if (preview.stopping) {
      spawnPreview(current, rt)
    } else {
      rt.previewState = 'error'
      rt.previewError = describeFailure(preview.lastLine)
      rt.previewRetry = setTimeout(() => {
        const current = findCamera(camera.id)
        if (current && previewWanted(rt) && !rt.preview) spawnPreview(current, rt)
        publish()
      }, RETRY_DELAY_MS)
    }
    publish()
  })
}

async function killPreview(rt: Runtime) {
  clearTimeout(rt.previewRetry)
  const preview = rt.preview
  if (!preview) return
  preview.stopping = true
  preview.proc.kill()
  await waitForExit(preview.proc)
}

/** Bật hoặc tắt tiến trình xem trực tiếp cho khớp với việc có ai đang xem hay không. */
function reconcilePreview(id: string, rt: Runtime) {
  const camera = findCamera(id)
  if (camera && previewWanted(rt)) {
    if (!rt.preview) spawnPreview(camera, rt)
  } else if (rt.preview) {
    // Handler `exit` sẽ đặt lại trạng thái (hoặc chạy lại nếu kịp có người xem mới).
    void killPreview(rt)
  } else {
    clearTimeout(rt.previewRetry)
    rt.previewState = 'off'
    rt.previewError = undefined
  }
}

function reconcileAllPreviews() {
  for (const [id, rt] of runtimes) reconcilePreview(id, rt)
  publish()
}

export function startPreview(id: string) {
  if (!findCamera(id)) return
  const rt = runtimeOf(id)
  rt.localPreview = true
  reconcilePreview(id, rt)
  publish()
}

export function stopPreview(id: string) {
  const rt = runtimes.get(id)
  if (!rt) return
  rt.localPreview = false
  reconcilePreview(id, rt)
  publish()
}

/** Cửa sổ ẩn dưới khay thì không giải mã cho nó nữa; camera nào đang mở vẫn được nhớ để chạy lại khi cửa sổ hiện. */
export function setPreviewsSuspended(suspended: boolean) {
  if (previewsSuspended === suspended) return
  previewsSuspended = suspended
  reconcileAllPreviews()
}

/** Cửa sổ đóng hoặc tải lại: nó không còn xem camera nào nữa. */
export function stopAllPreviews() {
  for (const rt of runtimes.values()) rt.localPreview = false
  reconcileAllPreviews()
}

/**
 * Một máy trạm bắt đầu xem camera qua web. Trả về hàm huỷ, hoặc null nếu camera không tồn tại.
 * Nhiều máy trạm dùng chung một tiến trình ffmpeg.
 */
export function addViewer(id: string, listener: FrameListener): (() => void) | null {
  if (!findCamera(id)) return null
  const rt = runtimeOf(id)
  const listeners = frameListeners.get(id) ?? new Set()
  frameListeners.set(id, listeners)
  listeners.add(listener)
  rt.remoteViewers++
  // Có sẵn khung hình thì gửi ngay, khỏi để máy trạm nhìn màn hình đen.
  if (rt.lastFrame) listener(rt.lastFrame)
  reconcilePreview(id, rt)
  publish()

  let removed = false
  return () => {
    if (removed) return
    removed = true
    listeners.delete(listener)
    // Camera có thể đã bị gỡ khỏi cài đặt trong lúc máy trạm đang xem.
    if (runtimes.get(id) !== rt) return
    rt.remoteViewers--
    reconcilePreview(id, rt)
    publish()
  }
}

// ---------------------------------------------------------------- vòng đời

/** Đưa các tiến trình về đúng với cài đặt mới: dừng camera đã tắt/xoá, khởi động lại camera đổi cấu hình. */
export async function sync(settings: AppSettings) {
  const enabled = new Map(settings.cameras.filter((c) => c.enabled).map((c) => [c.id, c]))

  for (const [id, rt] of runtimes) {
    const camera = enabled.get(id)
    if (!camera) {
      rt.wantRecording = false
      rt.localPreview = false
      rt.remoteViewers = 0
      await Promise.all([killRecorder(rt), killPreview(rt)])
      runtimes.delete(id)
      continue
    }
    // Tiến trình đang chạy với cấu hình cũ: dừng nó, handler `exit` sẽ tự chạy lại với cấu hình mới.
    if (rt.wantRecording && rt.recorder?.key !== recorderKey(camera, settings)) {
      if (rt.recorder) await killRecorder(rt)
      else spawnRecorder(camera, rt)
    }
    if (previewWanted(rt) && rt.preview?.key !== previewKey(camera)) {
      if (rt.preview) await killPreview(rt)
      else spawnPreview(camera, rt)
    }
  }
  for (const id of enabled.keys()) runtimeOf(id)

  if (firstSync) {
    firstSync = false
    if (settings.autoRecordOnStart) startAll()
  }
  publish()
}

/** Dừng mọi tiến trình ffmpeg và chờ chúng đóng file xong. Gọi trước khi app thoát. */
export async function shutdown() {
  shuttingDown = true
  for (const rt of runtimes.values()) rt.wantRecording = false
  await Promise.all([...runtimes.values()].flatMap((rt) => [killRecorder(rt), killPreview(rt)]))
}
