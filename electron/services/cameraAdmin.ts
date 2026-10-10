import { randomBytes } from 'node:crypto'
import {
  DEFAULT_RTSP_PORT,
  type AddCameraInput,
  type AddCameraResult,
  type CameraConfig,
  type DiscoveredDevice,
  type StreamTestResult,
} from '../../shared/types'
import * as cameraService from './cameraService'
import { normalizeMac, readArpTable } from './network/arp'
import { describe, detectPaths, type RtspTarget } from './network/rtspProbe'
import { findIpByMac, scanLan } from './network/scan'
import { getSettings, updateSettings } from './settingsStore'

interface ParsedTarget {
  host?: string
  mac?: string
  port?: number
  username?: string
  password?: string
  path?: string
}

/** Hiểu ba kiểu nhập: URL `rtsp://...`, địa chỉ MAC, hoặc IP/tên máy kèm cổng tuỳ chọn. */
function parseTarget(input: string): ParsedTarget | null {
  const target = input.trim()
  if (!target) return null

  if (/^rtsps?:\/\//i.test(target)) {
    try {
      // URL chuẩn không biết scheme rtsp nên không tách được host: mượn tạm http.
      const url = new URL(target.replace(/^rtsps?:/i, 'http:'))
      const path = url.pathname + url.search
      return {
        host: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        path: path === '/' ? undefined : path,
      }
    } catch {
      return null
    }
  }

  // Kiểm tra IPv4 trước: "192.168.100.100" cũng có đúng 12 chữ số như một địa chỉ MAC.
  const hostPort = /^([A-Za-z0-9.-]+?)(?::(\d{1,5}))?$/.exec(target)
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(target)
  if (!isIpv4) {
    const mac = normalizeMac(target)
    if (mac) return { mac }
  }
  if (!hostPort) return null
  return { host: hostPort[1], port: hostPort[2] ? Number(hostPort[2]) : undefined }
}

function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'camera'
}

const targetOf = (camera: CameraConfig): RtspTarget => ({
  host: camera.host,
  port: camera.rtspPort,
  username: camera.username,
  password: camera.password,
})

function describeStatus(status: number, target: RtspTarget): string {
  if (status === 0) return `Không kết nối được tới ${target.host}:${target.port}. Kiểm tra IP, cổng RTSP và camera đã bật RTSP chưa.`
  if (status === 401 || status === 403) return 'Sai tên đăng nhập hoặc mật khẩu.'
  if (status === 404) return 'Camera không có đường dẫn luồng này.'
  return `Camera từ chối kết nối (mã RTSP ${status}).`
}

export async function discover(): Promise<DiscoveredDevice[]> {
  const hits = await scanLan()
  const cameras = getSettings().cameras
  return hits.map((hit) => ({
    ...hit,
    known: cameras.some((c) => c.host === hit.ip || (hit.mac !== '' && c.mac === hit.mac)),
  }))
}

export async function addCamera(input: AddCameraInput): Promise<AddCameraResult> {
  const parsed = parseTarget(input.target)
  if (!parsed) {
    return { ok: false, error: 'Địa chỉ không hợp lệ. Nhập IP (vd. 192.168.1.64), MAC (vd. AA:BB:CC:DD:EE:FF) hoặc URL rtsp://…' }
  }

  let host = parsed.host
  if (!host && parsed.mac) {
    host = (await findIpByMac(parsed.mac, true)) ?? undefined
    if (!host) {
      return { ok: false, error: `Không tìm thấy thiết bị có MAC ${parsed.mac} trong mạng LAN. Camera phải đang bật và cùng mạng với máy này.` }
    }
  }
  if (!host) return { ok: false, error: 'Thiếu địa chỉ camera.' }

  const target: RtspTarget = {
    host,
    port: parsed.port ?? input.rtspPort ?? DEFAULT_RTSP_PORT,
    username: parsed.username ?? input.username.trim(),
    password: parsed.password ?? input.password,
  }

  let mainPath = parsed.path ?? input.path?.trim() ?? ''
  let subPath = ''
  if (mainPath) {
    if (!mainPath.startsWith('/')) mainPath = `/${mainPath}`
    const result = await describe(target, mainPath)
    if (result.status !== 200) return { ok: false, error: describeStatus(result.status, target) }
  } else {
    const detected = await detectPaths(target)
    if (!detected.ok) {
      const error =
        detected.reason === 'unreachable'
          ? describeStatus(0, target)
          : detected.reason === 'auth'
            ? describeStatus(401, target)
            : 'Không tự dò được luồng video của camera này. Hãy nhập đường dẫn luồng RTSP (xem tài liệu của hãng) rồi thử lại.'
      return { ok: false, error }
    }
    mainPath = detected.mainPath
    subPath = detected.subPath
  }

  const existing = getSettings().cameras
  if (existing.some((c) => c.host === host && c.rtspPort === target.port && c.mainPath === mainPath)) {
    return { ok: false, error: 'Camera này đã có trong danh sách.' }
  }

  // Vừa nối tới camera xong nên bảng ARP chắc chắn có MAC của nó (nếu cùng mạng LAN).
  const mac = parsed.mac ?? (await readArpTable()).get(host) ?? ''
  const name = input.name?.trim() || `Camera ${host}`
  const camera: CameraConfig = {
    id: `cam-${randomBytes(4).toString('hex')}`,
    name,
    folder: `${slugify(name)}-${randomBytes(2).toString('hex')}`,
    enabled: true,
    host,
    mac,
    rtspPort: target.port,
    username: target.username,
    password: target.password,
    mainPath,
    subPath,
    transport: 'tcp',
    recordAudio: false,
    test: false,
  }
  const settings = updateSettings({ cameras: [...existing, camera] })
  await cameraService.sync(settings)
  return { ok: true, settings, camera }
}

/** Thêm một camera giả lập phát hình thử, để thử ghi hình và stream khi chưa có camera thật. */
export async function addTestCamera(): Promise<AddCameraResult> {
  const existing = getSettings().cameras
  const name = `Camera test ${existing.filter((c) => c.test).length + 1}`
  const camera: CameraConfig = {
    id: `cam-${randomBytes(4).toString('hex')}`,
    name,
    folder: `${slugify(name)}-${randomBytes(2).toString('hex')}`,
    enabled: true,
    host: '',
    mac: '',
    rtspPort: DEFAULT_RTSP_PORT,
    username: '',
    password: '',
    mainPath: '/',
    subPath: '',
    transport: 'tcp',
    recordAudio: false,
    test: true,
  }
  const settings = updateSettings({ cameras: [...existing, camera] })
  await cameraService.sync(settings)
  return { ok: true, settings, camera }
}

export async function testCamera(cameraId: string): Promise<StreamTestResult> {
  const camera = getSettings().cameras.find((c) => c.id === cameraId)
  if (!camera) return { ok: false, error: 'Không tìm thấy camera.' }
  if (camera.test) return { ok: true, codec: 'H264 (giả lập)' }
  const target = targetOf(camera)
  const result = await describe(target, camera.mainPath)
  if (result.status !== 200) return { ok: false, error: describeStatus(result.status, target) }
  return { ok: true, codec: result.codec }
}
