import { app, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_PLAYERS, PLAYER_NAME_MAX, SCORE_MAX, SCORE_MIN } from '../../shared/scores'
import {
  CAMERA_FOLDER_RE,
  CHANNEL_ID_RE,
  CHANNEL_QRS,
  DEFAULT_SCORE_COLOR_HIGH,
  DEFAULT_SCORE_COLOR_LOW,
  EXTERNAL_URL_RE,
  HEX_COLOR_RE,
  DEFAULT_PLAYER_COUNT,
  DEFAULT_RTSP_PORT,
  DEFAULT_WEB_PORT,
  SEGMENT_MINUTES,
  type AppSettings,
  type CameraConfig,
  type Channel,
  type Player,
} from '../../shared/types'

/** Tiền tố đánh dấu mật khẩu đã được hệ điều hành mã hoá (DPAPI trên Windows, Keychain trên macOS). */
const ENCRYPTED_PREFIX = 'enc:'

let cache: AppSettings | null = null

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function defaults(): AppSettings {
  return {
    storageDir: path.join(app.getPath('videos'), 'CutCam'),
    segmentMinutes: 5,
    retentionDays: 0,
    autoRecordOnStart: false,
    previewQuality: 'high',
    minimizeToTray: true,
    launchAtLogin: false,
    shopName: '',
    webEnabled: false,
    webPort: DEFAULT_WEB_PORT,
    webPassword: '',
    channels: [],
    cameras: [],
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function sanitizeCamera(raw: Partial<CameraConfig>): CameraConfig | null {
  const test = raw?.test === true
  if (typeof raw?.id !== 'string' || (!test && !text(raw.host))) return null
  if (typeof raw.folder !== 'string' || !CAMERA_FOLDER_RE.test(raw.folder)) return null
  const mainPath = text(raw.mainPath) || '/'
  const subPath = text(raw.subPath)
  return {
    id: raw.id,
    name: text(raw.name) || text(raw.host),
    folder: raw.folder,
    enabled: raw.enabled !== false,
    host: text(raw.host),
    mac: text(raw.mac).toUpperCase(),
    rtspPort: clamp(raw.rtspPort, 1, 65535, DEFAULT_RTSP_PORT),
    username: text(raw.username),
    // Mật khẩu có thể chứa khoảng trắng ở đầu/cuối: giữ nguyên.
    password: typeof raw.password === 'string' ? raw.password : '',
    mainPath: mainPath.startsWith('/') ? mainPath : `/${mainPath}`,
    subPath: subPath && !subPath.startsWith('/') ? `/${subPath}` : subPath,
    transport: raw.transport === 'udp' ? 'udp' : 'tcp',
    recordAudio: raw.recordAudio === true && !test,
    test,
  }
}

function sanitizePlayers(raw: unknown): Player[] {
  // Kênh mới (hoặc kênh tạo từ bản cũ chưa có bảng điểm) bắt đầu với hai người chơi.
  if (!Array.isArray(raw)) {
    return Array.from({ length: DEFAULT_PLAYER_COUNT }, (_, i) => ({
      id: randomBytes(4).toString('hex'),
      name: `Người chơi ${i + 1}`,
      score: 0,
    }))
  }
  const seen = new Set<string>()
  const players: Player[] = []
  for (const item of raw as Partial<Player>[]) {
    const id = text(item?.id) || randomBytes(4).toString('hex')
    if (seen.has(id)) continue
    seen.add(id)
    players.push({
      id,
      name: text(item.name).slice(0, PLAYER_NAME_MAX) || `Người chơi ${players.length + 1}`,
      score: clamp(item.score, SCORE_MIN, SCORE_MAX, 0),
    })
  }
  return players.slice(0, MAX_PLAYERS)
}

const externalUrl = (value: unknown) => (EXTERNAL_URL_RE.test(text(value)) ? text(value).slice(0, 500) : '')
const hexColor = (value: unknown, fallback: string) => (HEX_COLOR_RE.test(text(value)) ? text(value).toLowerCase() : fallback)

function sanitizeChannels(raw: unknown, cameras: CameraConfig[]): Channel[] {
  if (!Array.isArray(raw)) return []
  const cameraIds = new Set(cameras.map((c) => c.id))
  const seen = new Set<string>()
  const channels: Channel[] = []
  for (const item of raw as Partial<Channel>[]) {
    const id = text(item?.id).toLowerCase()
    if (!CHANNEL_ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    channels.push({
      id,
      name: text(item.name) || id,
      // Camera đã bị gỡ khỏi danh sách thì cũng rời khỏi kênh.
      cameraIds: Array.isArray(item.cameraIds) ? [...new Set(item.cameraIds)].filter((c) => cameraIds.has(c)) : [],
      public: item.public === true,
      showVideo: item.showVideo === true,
      // Mật khẩu có thể chứa khoảng trắng ở đầu/cuối: giữ nguyên.
      password: typeof item.password === 'string' ? item.password.slice(0, 100) : '',
      orderUrl: externalUrl(item.orderUrl),
      billUrl: externalUrl(item.billUrl),
      hideAllQrs: item.hideAllQrs === true,
      hiddenQrs: CHANNEL_QRS.filter((qr) => Array.isArray(item.hiddenQrs) && item.hiddenQrs.includes(qr)),
      scoreColorHigh: hexColor(item.scoreColorHigh, DEFAULT_SCORE_COLOR_HIGH),
      scoreColorLow: hexColor(item.scoreColorLow, DEFAULT_SCORE_COLOR_LOW),
      sessionNo: clamp(item.sessionNo, 1, 1_000_000_000, 1),
      sessionEnded: item.sessionEnded === true,
      players: sanitizePlayers(item.players),
    })
  }
  return channels
}

function sanitize(raw: Partial<AppSettings>): AppSettings {
  const base = defaults()
  const segmentMinutes = Number(raw.segmentMinutes)
  const cameras = Array.isArray(raw.cameras)
    ? raw.cameras.map(sanitizeCamera).filter((c): c is CameraConfig => c !== null)
    : base.cameras
  const webEnabled = raw.webEnabled === true
  let webPassword = typeof raw.webPassword === 'string' ? raw.webPassword : ''
  // Không bao giờ mở cổng xem từ xa mà không có mật khẩu: bật lần đầu thì tự sinh một cái.
  if (webEnabled && !webPassword) webPassword = randomBytes(6).toString('base64url')
  return {
    storageDir:
      typeof raw.storageDir === 'string' && path.isAbsolute(raw.storageDir)
        ? path.normalize(raw.storageDir)
        : base.storageDir,
    segmentMinutes: (SEGMENT_MINUTES as readonly number[]).includes(segmentMinutes)
      ? segmentMinutes
      : base.segmentMinutes,
    retentionDays: clamp(raw.retentionDays, 0, 3650, base.retentionDays),
    autoRecordOnStart: raw.autoRecordOnStart === true,
    previewQuality: raw.previewQuality === 'standard' ? 'standard' : base.previewQuality,
    minimizeToTray: raw.minimizeToTray !== false,
    launchAtLogin: raw.launchAtLogin === true,
    shopName: text(raw.shopName).slice(0, 60),
    webEnabled,
    webPort: clamp(raw.webPort, 1, 65535, base.webPort),
    webPassword,
    channels: sanitizeChannels(raw.channels, cameras),
    cameras,
  }
}

function encryptPassword(password: string): string {
  if (!password || !safeStorage.isEncryptionAvailable()) return password
  return ENCRYPTED_PREFIX + safeStorage.encryptString(password).toString('base64')
}

function decryptPassword(stored: unknown): string {
  if (typeof stored !== 'string') return ''
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'))
  } catch {
    // File cài đặt được chép từ máy hoặc tài khoản khác: phải nhập lại mật khẩu.
    return ''
  }
}

export function getSettings(): AppSettings {
  if (cache) return cache
  let raw: Partial<AppSettings> = {}
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    raw.webPassword = decryptPassword(raw.webPassword)
    if (Array.isArray(raw.cameras)) {
      raw.cameras = raw.cameras.map((c) => ({ ...c, password: decryptPassword(c?.password) }))
    }
    if (Array.isArray(raw.channels)) {
      raw.channels = raw.channels.map((c) => ({ ...c, password: decryptPassword(c?.password) }))
    }
  } catch {
    // Chưa có file hoặc file hỏng: dùng mặc định.
  }
  cache = sanitize(raw)
  return cache
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  cache = sanitize({ ...getSettings(), ...patch })
  const onDisk = {
    ...cache,
    webPassword: encryptPassword(cache.webPassword),
    cameras: cache.cameras.map((c) => ({ ...c, password: encryptPassword(c.password) })),
    channels: cache.channels.map((c) => ({ ...c, password: encryptPassword(c.password) })),
  }
  const file = settingsFile()
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2))
  fs.renameSync(tmp, file)
  return cache
}
