import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { CHANNEL_PARAM, CHANNEL_PATH_RE, LIVE_FRAME_LENGTH_BYTES, MEDIA_LIMIT_PARAM, WEB_API } from '../../shared/ipc'
import { applyScoreAction, LOCKED_WHEN_ENDED, sessionNames, type ScoreAction } from '../../shared/scores'
import { CUT_MAX_MS, type AppSettings, type CameraConfig, type ClipInfo, type WebServerStatus } from '../../shared/types'
import * as cameraService from './cameraService'
import { clearClips, getClip, type ClipRequest } from './clipExport'
import * as recordings from './recordingStore'
import { endSession, recordScoreChanges, startSession } from './scoreHistory'
import { openFile, openSegment } from './segmentFile'
import { getSettings, updateSettings } from './settingsStore'

// Máy chủ HTTP cho các máy trạm trong mạng LAN: xem trực tiếp và xem lại bằng trình duyệt.
// Máy trạm chỉ được xem, trừ một việc: ghi điểm cho kênh mình đang mở. Mọi thao tác thay đổi khác
// (thêm camera, ghi, xoá...) chỉ làm được trên máy chủ.

const SESSION_COOKIE = 'cutcam_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_LOGIN_FAILURES = 5
const LOGIN_LOCK_MS = 60 * 1000
const MAX_BODY_BYTES = 4096
const MAX_LIVE_CAMERAS = 64

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

let server: http.Server | null = null
let staticDir = ''
let running: { port: number; password: string } | null = null
let lastError: string | undefined
/** Địa chỉ máy chủ dev của Vite; chỉ có khi chạy `npm run dev`. */
let devServerUrl = ''
let onSettingsChanged: (settings: AppSettings) => void = () => {}

/** Máy trạm vừa sửa bảng điểm: báo để cửa sổ app trên máy chủ cập nhật theo. */
export function setSettingsListener(listener: (settings: AppSettings) => void) {
  onSettingsChanged = listener
}

interface Session {
  expires: number
  /** Kênh mà phiên này được vào, khi đăng nhập bằng mật khẩu riêng của kênh. null = mật khẩu chung, vào được mọi thứ. */
  channelId: string | null
  /** Mật khẩu kênh lúc đăng nhập: máy chủ đổi mật khẩu kênh thì phiên này hết hiệu lực. */
  channelPassword: string
}

/** Các phiên đăng nhập. Giữ trong bộ nhớ: khởi động lại app thì máy trạm đăng nhập lại. */
const sessions = new Map<string, Session>()
/** Chống dò mật khẩu: IP -> số lần sai liên tiếp và thời điểm được thử lại. */
const loginFailures = new Map<string, { count: number; lockedUntil: number }>()

// ---------------------------------------------------------------- tiện ích

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

function sessionOf(req: IncomingMessage): Session | null {
  const token = readCookie(req, SESSION_COOKIE)
  const session = token ? sessions.get(token) : undefined
  if (!token || !session) return null
  if (session.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  return session
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/** So sánh không lộ thời gian; băm trước để hai bên luôn cùng độ dài. */
function samePassword(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

// ---------------------------------------------------------------- đăng nhập

async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  const ip = req.socket.remoteAddress ?? ''
  const failures = loginFailures.get(ip)
  if (failures && failures.lockedUntil > Date.now()) {
    const seconds = Math.ceil((failures.lockedUntil - Date.now()) / 1000)
    return sendJson(res, 429, { error: `Sai mật khẩu quá nhiều lần. Thử lại sau ${seconds} giây.` })
  }

  let password = ''
  let channelId = ''
  try {
    const body = JSON.parse(await readBody(req))
    password = String(body?.password ?? '')
    channelId = String(body?.channel ?? '').toLowerCase()
  } catch {
    return sendJson(res, 400, { error: 'Yêu cầu không hợp lệ.' })
  }

  // Mật khẩu chung vào được mọi thứ; mật khẩu riêng của kênh chỉ vào được kênh đang mở.
  let session: Session | null = null
  if (running && samePassword(password, running.password)) {
    session = { expires: Date.now() + SESSION_TTL_MS, channelId: null, channelPassword: '' }
  } else if (running) {
    const channel = getSettings().channels.find((c) => c.id === channelId && !c.public && c.password)
    if (channel && samePassword(password, channel.password)) {
      session = { expires: Date.now() + SESSION_TTL_MS, channelId: channel.id, channelPassword: channel.password }
    }
  }
  if (!session) {
    const count = (failures?.count ?? 0) + 1
    loginFailures.set(ip, { count, lockedUntil: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0 })
    return sendJson(res, 401, { error: 'Sai mật khẩu.' })
  }

  loginFailures.delete(ip)
  const token = randomBytes(32).toString('hex')
  sessions.set(token, session)
  sendJson(res, 200, { ok: true }, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
  })
}

function handleLogout(req: IncomingMessage, res: ServerResponse) {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) sessions.delete(token)
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` })
}

// ---------------------------------------------------------------- quyền xem

/** Những camera một yêu cầu được phép thấy. */
interface Access {
  /** Đã đăng nhập bằng mật khẩu, hay chỉ đang xem một kênh công khai. */
  authenticated: boolean
  cameras: CameraConfig[]
}

/**
 * Đăng nhập bằng mật khẩu chung thì xem được mọi camera. Ngoài ra chỉ xem được camera của kênh mà
 * yêu cầu nêu trong tham số `channel`, và chỉ khi kênh đó công khai (máy chủ bật "không cần mật
 * khẩu") hoặc đã đăng nhập bằng mật khẩu riêng của chính kênh đó; mọi thứ ngoài kênh đều bị từ
 * chối, kể cả khi đoán được id camera.
 */
function accessOf(req: IncomingMessage, url: URL): Access | null {
  const settings = getSettings()
  const session = sessionOf(req)
  if (session && session.channelId === null) return { authenticated: true, cameras: settings.cameras }
  const channelId = url.searchParams.get(CHANNEL_PARAM)?.toLowerCase()
  const channel = channelId ? settings.channels.find((c) => c.id === channelId) : undefined
  if (!channel) return null
  const unlocked =
    session?.channelId === channel.id && !!channel.password && samePassword(session.channelPassword, channel.password)
  if (!channel.public && !unlocked) return null
  return { authenticated: false, cameras: settings.cameras.filter((c) => channel.cameraIds.includes(c.id)) }
}

// ---------------------------------------------------------------- dữ liệu cho máy trạm

/**
 * Máy trạm chỉ cần tên camera để hiển thị: không gửi địa chỉ, tài khoản hay mật khẩu camera.
 * Có `channelId` thì chỉ trả về kênh đó và các camera được gán cho nó; kênh không tồn tại thì
 * danh sách kênh và camera đều rỗng.
 */
function publicSettings(settings: AppSettings, channelId: string | null): AppSettings {
  const channel = channelId === null ? null : settings.channels.find((c) => c.id === channelId.toLowerCase())
  const visible = channelId === null ? settings.cameras : settings.cameras.filter((c) => channel?.cameraIds.includes(c.id))
  return {
    ...settings,
    storageDir: '',
    webPassword: '',
    channels: (channelId === null ? settings.channels : channel ? [channel] : []).map((c) => ({ ...c, password: '' })),
    cameras: visible.map((camera) => ({
      ...camera,
      host: '',
      mac: '',
      username: '',
      password: '',
      mainPath: '',
      subPath: '',
    })),
  }
}

async function handleRecordings(url: URL, access: Access, res: ServerResponse) {
  const cameraFolder = url.searchParams.get('cameraFolder') ?? ''
  if (!access.cameras.some((c) => c.folder === cameraFolder)) return sendJson(res, 403, { error: 'Không có quyền xem camera này.' })
  // Người xem kênh công khai không có cookie: đường dẫn video phải mang theo tên kênh.
  const channel = url.searchParams.get(CHANNEL_PARAM)
  const channelQuery = channel ? `${CHANNEL_PARAM}=${encodeURIComponent(channel)}` : ''
  try {
    const segments = await recordings.list(getSettings().storageDir, {
      cameraFolder,
      fromMs: Number(url.searchParams.get('fromMs')),
      toMs: Number(url.searchParams.get('toMs')),
    })
    // Cửa sổ app phát qua `cutcam://`; máy trạm phát qua chính máy chủ này.
    sendJson(res, 200, segments.map((segment) => {
      const query = [new URL(segment.url).search.slice(1), channelQuery].filter(Boolean).join('&')
      return { ...segment, url: WEB_API.media + segment.id.split('/').map(encodeURIComponent).join('/') + (query ? `?${query}` : '') }
    }))
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message })
  }
}

async function handleMedia(req: IncomingMessage, url: URL, access: Access, res: ServerResponse) {
  const id = decodeURIComponent(url.pathname.slice(WEB_API.media.length))
  if (!access.cameras.some((c) => c.folder === id.split('/')[0])) return void res.writeHead(403).end()
  const limit = Number(url.searchParams.get(MEDIA_LIMIT_PARAM))
  const { status, headers, stream } = await openSegment(id, req.headers.range, limit)
  res.writeHead(status, headers)
  if (!stream || req.method === 'HEAD') {
    stream?.destroy()
    res.end()
    return
  }
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

/**
 * Sửa bảng điểm của một kênh. Ai mở được màn hình kênh (đã đăng nhập, hoặc kênh không cần mật khẩu)
 * thì ghi điểm được cho kênh đó, và chỉ kênh đó.
 */
async function handleScore(req: IncomingMessage, url: URL, res: ServerResponse) {
  // Bắt buộc JSON: trang web lạ không gửi được loại nội dung này sang máy chủ khác mà không bị trình duyệt chặn.
  if (!req.headers['content-type']?.startsWith('application/json')) return sendJson(res, 415, { error: 'Yêu cầu không hợp lệ.' })
  const channelId = url.searchParams.get(CHANNEL_PARAM)?.toLowerCase()
  let action: ScoreAction
  try {
    action = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { error: 'Yêu cầu không hợp lệ.' })
  }
  // Đọc cài đặt sau khi đã nhận xong yêu cầu: từ đây tới lúc lưu không có chỗ chờ nào, nên hai
  // người bấm cùng lúc không đè mất điểm của nhau.
  const { channels } = getSettings()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) return sendJson(res, 404, { error: 'Không tìm thấy kênh.' })
  let settings: AppSettings | null
  if (action?.op === 'reset') {
    // Reset cả bảng là kết thúc một phiên: chốt điểm rồi mới đưa về 0.
    settings = startSession(channel.id, 'web')
  } else if (action?.op === 'end') {
    settings = endSession(channel.id, 'web')
  } else if (channel.sessionEnded && LOCKED_WHEN_ENDED.includes(action?.op)) {
    return sendJson(res, 409, { error: 'Ván này đã kết thúc. Bấm "Ván mới" để chơi tiếp.' })
  } else if (action?.op === 'session') {
    const names = sessionNames(action.names)
    if (!names) return sendJson(res, 400, { error: 'Danh sách người chơi không hợp lệ.' })
    settings = startSession(channel.id, 'web', names)
  } else {
    const players = applyScoreAction(channel.players, action)
    if (!players) return sendJson(res, 400, { error: 'Thao tác không hợp lệ.' })
    settings = updateSettings({ channels: channels.map((c) => (c === channel ? { ...c, players } : c)) })
    recordScoreChanges(channels, settings.channels, 'web')
  }
  if (!settings) return sendJson(res, 404, { error: 'Không tìm thấy kênh.' })
  onSettingsChanged(settings)
  const saved = settings.channels.find((c) => c.id === channelId)
  sendJson(res, 200, saved && { ...saved, password: '' })
}

/** Gửi khung hình của các camera được yêu cầu trên một kết nối giữ mở (định dạng: xem `shared/ipc.ts`). */
function handleLive(req: IncomingMessage, url: URL, access: Access, res: ServerResponse) {
  const requested = new Set((url.searchParams.get('ids') ?? '').split(',').filter(Boolean))
  const ids = access.cameras.map((c) => c.id).filter((id) => requested.has(id)).slice(0, MAX_LIVE_CAMERAS)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  })
  // Gửi header ngay: nếu camera chưa có khung hình nào thì máy trạm vẫn biết là đã nối được.
  res.flushHeaders()
  req.socket.setKeepAlive(true, 30_000)

  // Máy trạm chậm hơn tốc độ khung hình thì bỏ bớt khung, không dồn ứ trong bộ nhớ máy chủ.
  let congested = false
  const unsubscribers = ids.map((id) => {
    const idBytes = Buffer.from(id, 'utf8')
    return cameraService.addViewer(id, (jpeg) => {
      if (congested || res.destroyed) return
      const header = Buffer.alloc(1 + idBytes.length + LIVE_FRAME_LENGTH_BYTES)
      header.writeUInt8(idBytes.length, 0)
      idBytes.copy(header, 1)
      header.writeUInt32BE(jpeg.length, 1 + idBytes.length)
      if (!res.write(Buffer.concat([header, jpeg]))) {
        congested = true
        res.once('drain', () => (congested = false))
      }
    })
  })
  res.on('close', () => unsubscribers.forEach((unsubscribe) => unsubscribe?.()))
}

/** Đọc và kiểm tra tham số của một yêu cầu cắt video. Trả về chuỗi nếu yêu cầu không hợp lệ. */
function parseClipRequest(url: URL, access: Access): ClipRequest | { status: number; error: string } {
  const camera = access.cameras.find((c) => c.id === url.searchParams.get('cameraId'))
  if (!camera) return { status: 403, error: 'Không có quyền xem camera này.' }
  const fromMs = Number(url.searchParams.get('fromMs'))
  const toMs = Number(url.searchParams.get('toMs'))
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return { status: 400, error: 'Khoảng thời gian không hợp lệ.' }
  }
  if (toMs - fromMs > CUT_MAX_MS) {
    return { status: 400, error: `Mỗi lần chỉ lấy được tối đa ${CUT_MAX_MS / 60_000} phút.` }
  }

  const seconds = (name: string) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined)
  const startSec = seconds('start')
  const endSec = seconds('end')
  const maxSec = (toMs - fromMs) / 1000 + 60
  for (const value of [startSec, endSec]) {
    if (value !== undefined && !(value >= 0 && value <= maxSec)) return { status: 400, error: 'Đoạn chọn không hợp lệ.' }
  }
  if (endSec !== undefined && endSec - (startSec ?? 0) < 0.5) return { status: 400, error: 'Đoạn chọn quá ngắn.' }

  return {
    camera,
    fromMs,
    toMs,
    startSec,
    endSec,
    codec: url.searchParams.get('codec') === 'h264' ? 'h264' : 'copy',
    preview: url.searchParams.get('preview') === '1',
    thumbnails: url.searchParams.get('thumbnails') === '1',
  }
}

/** Chuẩn bị file (có thể mất một lúc nếu phải chuyển sang H.264) rồi báo lại là đã sẵn sàng. */
async function handleCutInfo(url: URL, access: Access, res: ServerResponse) {
  const request = parseClipRequest(url, access)
  if ('error' in request) return sendJson(res, request.status, { error: request.error })
  const clip = await getClip(request)
  if (!clip.ok) return sendJson(res, clip.status, { error: clip.error })
  const info: ClipInfo = {
    url: WEB_API.cut + url.search,
    sourceCodec: clip.sourceCodec,
    sizeBytes: fs.statSync(clip.file).size,
    durationSec: clip.durationSec,
  }
  sendJson(res, 200, info)
}

/** Phát hoặc tải file MP4 của một khoảng thời gian. Có hỗ trợ Range để trình phát tua được. */
async function handleCut(req: IncomingMessage, url: URL, access: Access, res: ServerResponse) {
  const request = parseClipRequest(url, access)
  if ('error' in request) return sendJson(res, request.status, { error: request.error })
  const clip = await getClip(request)
  if (!clip.ok) return sendJson(res, clip.status, { error: clip.error })

  const { status, headers, stream } = await openFile(clip.file, req.headers.range)
  headers['Cache-Control'] = 'no-store'
  if (url.searchParams.get('download') === '1') {
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = (ms: number) => {
      const d = new Date(ms)
      return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    }
    const startMs = request.fromMs + (request.startSec ?? 0) * 1000
    const endMs = request.endSec !== undefined ? request.fromMs + request.endSec * 1000 : request.toMs
    const day = new Date(startMs)
    const date = `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}`
    const suffix = request.codec === 'h264' ? '_h264' : ''
    const name = `cutcam_${request.camera.folder}_${date}_${stamp(startMs)}-${stamp(endMs)}${suffix}.mp4`
    headers['Content-Disposition'] = `attachment; filename="${name}"`
  }
  res.writeHead(status, headers)
  if (!stream || req.method === 'HEAD') {
    stream?.destroy()
    res.end()
    return
  }
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

// ---------------------------------------------------------------- giao diện web

function serveStatic(pathname: string, res: ServerResponse) {
  const decoded = decodeURIComponent(pathname)
  // Trang kênh nằm sâu trong đường dẫn (/channel/<id>, /channel/<id>/cut/<camera>), nên trình duyệt
  // xin các file kèm theo dưới dạng /channel/<id>/assets/...: tìm lại chúng theo phần đuôi.
  const candidates = [decoded]
  if (CHANNEL_PATH_RE.test(decoded)) {
    const assets = decoded.lastIndexOf('/assets/')
    if (assets >= 0) candidates.push(decoded.slice(assets))
    candidates.push(path.posix.basename(decoded))
  }
  let file = path.join(staticDir, 'index.html')
  for (const candidate of candidates) {
    const resolved = path.resolve(staticDir, candidate.replace(/^\/+/, ''))
    const inside = path.relative(staticDir, resolved)
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      res.writeHead(403).end()
      return
    }
    // Không ứng viên nào là file thật thì trả về trang chính.
    if (inside && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      file = resolved
      break
    }
  }
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Chưa có giao diện web. Hãy chạy "npm run build" trên máy chủ rồi mở lại CutCam.')
    return
  }
  const isIndex = path.basename(file) === 'index.html'
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    // File trong assets/ có mã băm trong tên nên giữ lâu được; index.html thì luôn lấy mới.
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  fs.createReadStream(file).pipe(res)
}

/** Lúc chạy `npm run dev`, giao diện lấy từ máy chủ dev của Vite thay vì thư mục đã build. */
export function setDevServer(url: string | undefined) {
  devServerUrl = url ?? ''
}

/**
 * Chuyển yêu cầu giao diện sang máy chủ dev của Vite, để máy trạm luôn thấy mã nguồn mới nhất
 * mà không phải build lại. Vite tự trả trang chính cho các đường dẫn như `/channel/<id>`.
 */
function proxyToDevServer(req: IncomingMessage, res: ServerResponse) {
  const target = new URL(req.url ?? '/', devServerUrl)
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (reply) => {
    res.writeHead(reply.statusCode ?? 502, reply.headers)
    reply.pipe(res)
  })
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Không kết nối được tới máy chủ dev của Vite.')
  })
  res.on('close', () => upstream.destroy())
  upstream.end()
}

// ---------------------------------------------------------------- định tuyến

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const { pathname } = url
  const method = req.method ?? 'GET'

  if (pathname === WEB_API.login && method === 'POST') return handleLogin(req, res)
  if (pathname === WEB_API.logout && method === 'POST') return handleLogout(req, res)

  const isApi = pathname.startsWith('/api/') || pathname.startsWith(WEB_API.media)
  if (!isApi) {
    if (method !== 'GET' && method !== 'HEAD') return void res.writeHead(405).end()
    return devServerUrl ? proxyToDevServer(req, res) : serveStatic(pathname, res)
  }

  const access = accessOf(req, url)
  if (!access) return sendJson(res, 401, { error: 'Chưa đăng nhập.' })
  if (pathname === WEB_API.score && method === 'POST') return handleScore(req, url, res)
  if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Máy trạm chỉ được xem.' })

  if (pathname === WEB_API.session) return sendJson(res, 200, { ok: true, authenticated: access.authenticated })
  if (pathname === WEB_API.settings) {
    return sendJson(res, 200, publicSettings(getSettings(), url.searchParams.get(CHANNEL_PARAM)))
  }
  if (pathname === WEB_API.status) {
    const all = cameraService.status()
    return sendJson(res, 200, Object.fromEntries(access.cameras.filter((c) => all[c.id]).map((c) => [c.id, all[c.id]])))
  }
  if (pathname === WEB_API.recordings) return handleRecordings(url, access, res)
  if (pathname === WEB_API.live) return handleLive(req, url, access, res)
  if (pathname === WEB_API.cutInfo) return handleCutInfo(url, access, res)
  if (pathname === WEB_API.cut) return handleCut(req, url, access, res)
  if (pathname.startsWith(WEB_API.media)) return handleMedia(req, url, access, res)
  sendJson(res, 404, { error: 'Không tìm thấy.' })
}

// ---------------------------------------------------------------- vòng đời

function stop(): Promise<void> {
  const current = server
  server = null
  running = null
  if (!current) return Promise.resolve()
  return new Promise((resolve) => {
    current.close(() => resolve())
    // Các kết nối xem trực tiếp giữ mở mãi: phải chủ động cắt thì `close` mới xong.
    current.closeAllConnections()
  })
}

function start(port: number, password: string): Promise<void> {
  return new Promise((resolve) => {
    const next = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        console.error('[web]', err)
        if (!res.headersSent) sendJson(res, 500, { error: 'Lỗi máy chủ.' })
        else res.destroy()
      })
    })
    next.once('error', (err: NodeJS.ErrnoException) => {
      lastError =
        err.code === 'EADDRINUSE'
          ? `Cổng ${port} đang được chương trình khác sử dụng. Hãy chọn cổng khác (vd. 8088).`
          : err.code === 'EACCES'
            ? `Hệ điều hành không cho mở cổng ${port}. Hãy chọn cổng từ 1024 trở lên (vd. 8088).`
            : err.message
      resolve()
    })
    next.listen(port, '0.0.0.0', () => {
      server = next
      running = { port, password }
      lastError = undefined
      resolve()
    })
  })
}

/** Bật, tắt hoặc khởi động lại máy chủ cho khớp với cài đặt. `dir` là thư mục chứa giao diện web đã build. */
export async function applyWebServer(settings: AppSettings, dir: string) {
  staticDir = dir
  const wanted = settings.webEnabled ? { port: settings.webPort, password: settings.webPassword } : null
  const unchanged = wanted
    ? running?.port === wanted.port && running.password === wanted.password
    : !running && !lastError
  if (unchanged) return
  // Đổi mật khẩu thì mọi máy trạm phải đăng nhập lại.
  if (wanted?.password !== running?.password) sessions.clear()
  await stop()
  lastError = undefined
  if (wanted) await start(wanted.port, wanted.password)
}

export function webServerStatus(): WebServerStatus {
  const port = running?.port ?? getSettings().webPort
  const urls = running
    ? Object.values(os.networkInterfaces())
        .flat()
        .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
        .map((i) => `http://${i.address}${port === 80 ? '' : `:${port}`}`)
    : []
  return { running: !!running, port, urls, error: lastError }
}

export async function stopWebServer() {
  await stop()
  clearClips()
}
