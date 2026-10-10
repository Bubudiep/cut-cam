import { CHANNEL_PARAM, CHANNEL_PATH_RE, CONTROL_PATH_RE, CUT_PATH_RE, LIVE_FRAME_LENGTH_BYTES, WEB_API } from '../../shared/ipc'
import type { ScoreAction } from '../../shared/scores'
import type {
  AppSettings,
  CameraStatusMap,
  Channel,
  ClipCodec,
  ClipInfo,
  CutCamApi,
  RecordingSegment,
} from '../../shared/types'

// Bản cài đặt `window.cutcam` cho máy trạm: cùng giao diện với cửa sổ app, nhưng nói chuyện với
// máy chủ CutCam qua HTTP thay vì IPC. Máy trạm chỉ xem, nên các thao tác thay đổi đều bị từ chối.

const STATUS_POLL_MS = 2000
const LIVE_RECONNECT_MS = 3000

/** Máy trạm mở `/channel/<id>`: chỉ hiện các camera máy chủ đã gán cho kênh đó. */
export const channelId = decodeURIComponent(CHANNEL_PATH_RE.exec(window.location.pathname)?.[1] ?? '') || null

/** Máy trạm mở `/channel/<id>/cut/<camera>`: trang cắt video của camera đó. */
export const cutCameraId = decodeURIComponent(CUT_PATH_RE.exec(window.location.pathname)?.[2] ?? '') || null

/** Máy trạm mở `/channel/<id>/control`: trang ghi điểm của kênh. */
export const isControlPage = CONTROL_PATH_RE.test(window.location.pathname)

// Màn hình kênh hiện bảng điểm nên phải thấy điểm đổi gần như ngay; các trang khác chỉ cần
// biết khi máy chủ thêm bớt camera.
const SETTINGS_POLL_MS = channelId ? 1500 : 15_000

export interface ClipQuery {
  cameraId: string
  fromMs: number
  toMs: number
  /** Đoạn con bên trong khoảng trên, tính bằng giây từ đầu. Bỏ trống = lấy trọn. */
  startSec?: number
  endSec?: number
  codec?: ClipCodec
  /** Bản xem thử nhẹ bằng H.264, cho thiết bị không phát được codec gốc. */
  preview?: boolean
}

/**
 * Nhờ máy chủ chuẩn bị một đoạn video và chờ tới khi xong (chuyển sang H.264 có thể mất cả phút).
 * Ném lỗi kèm thông báo của máy chủ nếu không làm được.
 */
export async function prepareClip(query: ClipQuery): Promise<ClipInfo> {
  const params = new URLSearchParams({
    cameraId: query.cameraId,
    fromMs: String(query.fromMs),
    toMs: String(query.toMs),
  })
  if (query.startSec !== undefined) params.set('start', query.startSec.toFixed(2))
  if (query.endSec !== undefined) params.set('end', query.endSec.toFixed(2))
  if (query.codec) params.set('codec', query.codec)
  if (query.preview) params.set('preview', '1')

  const response = await fetch(withChannel(`${WEB_API.cutInfo}?${params}`), { credentials: 'same-origin' })
  if (response.status === 401) unauthorizedListeners.forEach((listener) => listener())
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `Máy chủ trả về lỗi ${response.status}`)
  return body as ClipInfo
}

/** Gửi một thao tác ghi điểm cho kênh đang mở. Trả về kênh sau khi máy chủ đã sửa. */
export async function sendScoreAction(action: ScoreAction): Promise<Channel> {
  const response = await fetch(withChannel(WEB_API.score), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  })
  if (response.status === 401) unauthorizedListeners.forEach((listener) => listener())
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `Máy chủ trả về lỗi ${response.status}`)
  return body as Channel
}

/** Dải ảnh thu nhỏ của một khoảng xem lại đã chuẩn bị, để lót thanh thời gian. */
export const clipThumbnailsUrl = (info: ClipInfo) => `${info.url}&thumbnails=1`

/** Mở hộp thoại tải về của trình duyệt cho một đoạn video đã chuẩn bị xong. */
export function downloadClip(info: ClipInfo) {
  const link = document.createElement('a')
  link.href = `${info.url}&download=1`
  link.download = ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * Gắn tên kênh vào yêu cầu. Máy chủ dựa vào đó để lọc camera, và để cho xem kênh công khai
 * mà không cần đăng nhập.
 */
function withChannel(url: string): string {
  if (channelId === null) return url
  return `${url}${url.includes('?') ? '&' : '?'}${CHANNEL_PARAM}=${encodeURIComponent(channelId)}`
}

const unauthorizedListeners = new Set<() => void>()

/** Phiên đăng nhập hết hạn hoặc máy chủ đổi mật khẩu: giao diện cần quay về màn hình đăng nhập. */
export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(withChannel(url), { credentials: 'same-origin' })
  if (response.status === 401) {
    unauthorizedListeners.forEach((listener) => listener())
    throw new Error('Chưa đăng nhập')
  }
  if (!response.ok) throw new Error(`Máy chủ trả về lỗi ${response.status}`)
  return response.json()
}

export type SessionState = 'none' | 'public' | 'authenticated'

/** `public`: chưa đăng nhập nhưng đang mở một kênh máy chủ cho xem không cần mật khẩu. */
export async function checkSession(): Promise<SessionState> {
  const response = await fetch(withChannel(WEB_API.session), { credentials: 'same-origin' })
  if (!response.ok) return 'none'
  return (await response.json()).authenticated ? 'authenticated' : 'public'
}

/** Trả về null nếu đăng nhập được, ngược lại là thông báo lỗi. */
export async function login(password: string): Promise<string | null> {
  try {
    const response = await fetch(WEB_API.login, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      // Kèm tên kênh đang mở: mật khẩu riêng của kênh chỉ có nghĩa với kênh đó.
      body: JSON.stringify({ password, channel: channelId ?? undefined }),
    })
    if (response.ok) return null
    return (await response.json().catch(() => null))?.error ?? 'Không đăng nhập được.'
  } catch {
    return 'Không kết nối được tới máy chủ.'
  }
}

export async function logout() {
  await fetch(WEB_API.logout, { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  // Tải lại để hỏi máy chủ từ đầu: kênh công khai thì vẫn xem tiếp được, còn lại quay về màn hình đăng nhập.
  window.location.reload()
}

function poll<T>(load: () => Promise<T>, listener: (value: T) => void, intervalMs: number) {
  const timer = window.setInterval(() => {
    // Mất mạng tạm thời: bỏ qua, lần sau thử lại.
    load().then(listener, () => {})
  }, intervalMs)
  return () => window.clearInterval(timer)
}

// ---------------------------------------------------------------- xem trực tiếp

type FrameListener = (cameraId: string, jpeg: Uint8Array) => void

const frameListeners = new Set<FrameListener>()
const wantedCameras = new Set<string>()
let liveConnection: AbortController | null = null
let liveRestartTimer: number | undefined

/** Tách các khung hình ra khỏi luồng byte (định dạng: xem `shared/ipc.ts`). Trả về phần chưa đủ một khung. */
function drainFrames(buffer: Uint8Array): Uint8Array {
  const decoder = new TextDecoder()
  let offset = 0
  for (;;) {
    if (buffer.length - offset < 1) break
    const idLength = buffer[offset]
    const headerLength = 1 + idLength + LIVE_FRAME_LENGTH_BYTES
    if (buffer.length - offset < headerLength) break
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset + 1 + idLength, LIVE_FRAME_LENGTH_BYTES)
    const frameLength = view.getUint32(0)
    if (buffer.length - offset < headerLength + frameLength) break
    const id = decoder.decode(buffer.subarray(offset + 1, offset + 1 + idLength))
    const jpeg = buffer.slice(offset + headerLength, offset + headerLength + frameLength)
    frameListeners.forEach((listener) => listener(id, jpeg))
    offset += headerLength + frameLength
  }
  return buffer.subarray(offset)
}

async function openLiveConnection() {
  liveConnection?.abort()
  liveConnection = null
  if (wantedCameras.size === 0) return

  const connection = new AbortController()
  liveConnection = connection
  try {
    const ids = [...wantedCameras].map(encodeURIComponent).join(',')
    const liveUrl = withChannel(`${WEB_API.live}?ids=${ids}`)
    const response = await fetch(liveUrl, { credentials: 'same-origin', signal: connection.signal })
    if (response.status === 401) unauthorizedListeners.forEach((listener) => listener())
    const reader = response.ok ? response.body?.getReader() : undefined
    let pending: Uint8Array = new Uint8Array(0)
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      const merged = new Uint8Array(pending.length + value.length)
      merged.set(pending)
      merged.set(value, pending.length)
      pending = drainFrames(merged)
    }
  } catch {
    // Bị huỷ để mở lại với danh sách camera mới, hoặc rớt mạng.
  }
  // Kết nối tự đứt (máy chủ khởi động lại, rớt mạng) chứ không phải do mình huỷ: nối lại.
  if (liveConnection === connection) {
    window.setTimeout(() => {
      if (liveConnection === connection) void openLiveConnection()
    }, LIVE_RECONNECT_MS)
  }
}

/** Nhiều ô camera hiện/ẩn cùng lúc: gom lại rồi mới mở lại kết nối một lần. */
function scheduleLiveRestart() {
  window.clearTimeout(liveRestartTimer)
  liveRestartTimer = window.setTimeout(() => void openLiveConnection(), 100)
}

// ---------------------------------------------------------------- API

const hostOnly = () => Promise.reject(new Error('Thao tác này chỉ thực hiện được trên máy chủ CutCam.'))

export function createWebApi(): CutCamApi {
  const loadSettings = () => getJson<AppSettings>(WEB_API.settings)
  const loadStatus = () => getJson<CameraStatusMap>(WEB_API.status)

  return {
    settings: {
      get: loadSettings,
      update: hostOnly,
      chooseStorageDir: async () => null,
      // Máy chủ thêm/bớt camera thì máy trạm tự thấy sau ít giây.
      onChanged: (listener) => poll(loadSettings, listener, SETTINGS_POLL_MS),
    },
    storage: {
      info: hostOnly,
      openDir: hostOnly,
    },
    cameras: {
      discover: hostOnly,
      add: hostOnly,
      addTest: hostOnly,
      test: hostOnly,
      status: loadStatus,
      onStatus: (listener) => poll(loadStatus, listener, STATUS_POLL_MS),
      startRecording: hostOnly,
      stopRecording: hostOnly,
      startAll: hostOnly,
      stopAll: hostOnly,
      startPreview: async (cameraId) => {
        wantedCameras.add(cameraId)
        scheduleLiveRestart()
      },
      stopPreview: async (cameraId) => {
        wantedCameras.delete(cameraId)
        scheduleLiveRestart()
      },
      onFrame: (listener) => {
        frameListeners.add(listener)
        return () => {
          frameListeners.delete(listener)
        }
      },
    },
    web: {
      status: async () => ({ running: false, port: 0, urls: [] }),
    },
    scores: {
      history: hostOnly,
      sessions: hostOnly,
      reset: hostOnly,
      end: hostOnly,
      newSession: hostOnly,
      clearHistory: hostOnly,
    },
    recordings: {
      list: ({ cameraFolder, fromMs, toMs }) =>
        getJson<RecordingSegment[]>(
          `${WEB_API.recordings}?cameraFolder=${encodeURIComponent(cameraFolder)}&fromMs=${fromMs}&toMs=${toMs}`,
        ),
      remove: hostOnly,
      reveal: hostOnly,
      exportTo: hostOnly,
    },
  }
}
