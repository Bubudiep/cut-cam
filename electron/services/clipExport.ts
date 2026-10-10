import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CLIP_THUMBNAIL_COUNT, type CameraConfig, type ClipCodec } from '../../shared/types'
import { ffmpegPath } from './ffmpeg'
import * as recordings from './recordingStore'
import { getSettings } from './settingsStore'

// Cắt video để xem lại và tải về, làm theo hai bước:
//
//  1. Clip gốc: ghép các file ghi hình nằm trong khoảng thời gian thành một file MP4. Chỉ chép
//     dữ liệu nên xong gần như ngay. Trang cắt video phát file này để người dùng xem lại và kéo
//     chọn đúng đoạn mình muốn.
//  2. Clip dẫn xuất: cắt lại từ clip gốc theo đoạn đã chọn, giữ nguyên codec (nhanh, điểm đầu
//     lệch tới khung khoá gần nhất) hoặc chuyển sang H.264 (chậm hơn, cắt chính xác, máy nào
//     cũng phát được).
//
// File tạo ra được giữ lại một lúc: trình phát xin file nhiều lần theo từng khúc (Range), và
// người dùng thường tải ngay thứ vừa xem.

const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_CACHED = 24
const MAX_CONCURRENT = 2
const COPY_TIMEOUT_MS = 2 * 60 * 1000
const TRANSCODE_TIMEOUT_MS = 15 * 60 * 1000
const CACHE_DIR = path.join(os.tmpdir(), 'cutcam-clips')

export interface ClipRequest {
  camera: CameraConfig
  fromMs: number
  toMs: number
  /** Đoạn con bên trong clip gốc, tính bằng giây từ đầu clip. Bỏ trống = lấy trọn. */
  startSec?: number
  endSec?: number
  codec: ClipCodec
  /** Bản xem thử độ phân giải thấp, cho thiết bị không phát được codec gốc. */
  preview: boolean
  /** Thay vì video, lấy một dải ảnh thu nhỏ trải đều theo thời gian để lót thanh thời gian. */
  thumbnails: boolean
}

export interface Clip {
  file: string
  /** Codec video của camera, vd. `hevc`, `h264`. */
  sourceCodec: string
  /** Độ dài của clip gốc, tính bằng giây. */
  durationSec: number
}

export type ClipResult = ({ ok: true } & Clip) | { ok: false; status: number; error: string }

interface CacheEntry {
  dir: string
  createdAt: number
  result: Promise<ClipResult>
}

const cache = new Map<string, CacheEntry>()

// File của lần chạy trước (app bị tắt giữa chừng) không còn ai dùng.
fs.rmSync(CACHE_DIR, { recursive: true, force: true })

function evict(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  fs.rm(entry.dir, { recursive: true, force: true }, () => {})
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache) if (now - entry.createdAt > CACHE_TTL_MS) evict(key)
}, 60 * 1000).unref()

/** Dọn mọi file tạm. Gọi khi app thoát. */
export function clearClips() {
  cache.clear()
  fs.rmSync(CACHE_DIR, { recursive: true, force: true })
}

// ---------------------------------------------------------------- chạy ffmpeg

let running = 0
const waiting: (() => void)[] = []

/** Chuyển mã rất nặng CPU: chỉ cho vài tiến trình chạy cùng lúc, số còn lại xếp hàng. */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Chạy ffmpeg tới khi xong. Trả về toàn bộ thông báo của nó, và có lỗi hay không. */
function runFfmpeg(args: string[], timeoutMs: number): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-nostats', ...args], { windowsHide: true })
    let log = ''
    proc.stderr.on('data', (chunk) => (log = (log + chunk).slice(-8000)))
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    proc.on('error', (err) => resolve({ ok: false, log: err.message }))
    proc.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, log })
    })
  })
}

/** Đường dẫn trong file danh sách của ffmpeg: nằm giữa hai dấu nháy đơn. */
const quote = (file: string) => `'${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`

const hasContent = async (file: string) => ((await fsp.stat(file).catch(() => null))?.size ?? 0) > 0

// ---------------------------------------------------------------- hai loại clip

async function buildBase(request: ClipRequest, dir: string): Promise<ClipResult> {
  const { camera, fromMs, toMs } = request
  const root = getSettings().storageDir
  const segments = (await recordings.list(root, { cameraFolder: camera.folder, fromMs, toMs })).filter((s) =>
    s.id.endsWith('.mp4'),
  )
  if (segments.length === 0) {
    return { ok: false, status: 404, error: 'Không có video nào được ghi trong khoảng thời gian này.' }
  }

  const lines = ['ffconcat version 1.0']
  for (const segment of segments) {
    const file = recordings.resolveSegment(root, segment.id)
    if (!file) continue
    lines.push(`file ${quote(file)}`)
    // Chỉ file đầu và file cuối mới cần cắt bớt; các file ở giữa lấy trọn.
    if (segment.startMs < fromMs) lines.push(`inpoint ${((fromMs - segment.startMs) / 1000).toFixed(3)}`)
    if (segment.endMs > toMs) lines.push(`outpoint ${((toMs - segment.startMs) / 1000).toFixed(3)}`)
  }
  const listFile = path.join(dir, 'list.ffconcat')
  const output = path.join(dir, 'clip.mp4')
  await fsp.writeFile(listFile, lines.join('\n'))

  const run = await withSlot(() =>
    runFfmpeg(
      // prettier-ignore
      ['-loglevel', 'info', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        // Đưa mục lục lên đầu file để điện thoại phát và lưu được ngay.
        '-movflags', '+faststart', '-y', output],
      COPY_TIMEOUT_MS,
    ),
  )
  if (!run.ok || !(await hasContent(output))) {
    console.error('[clip] base failed:', run.log.slice(-600))
    return { ok: false, status: 500, error: 'Không ghép được video. Thử lại với khoảng thời gian khác.' }
  }
  const sourceCodec = /Stream #0:\d+.*Video: (\w+)/.exec(run.log)?.[1] ?? 'unknown'
  // Không có file đầu ra thì ffmpeg thoát với mã lỗi, nhưng vẫn in thông tin của file đầu vào.
  const probe = await runFfmpeg(['-i', output], COPY_TIMEOUT_MS)
  const length = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.log)
  const durationSec = length
    ? Number(length[1]) * 3600 + Number(length[2]) * 60 + Number(length[3])
    : (toMs - fromMs) / 1000
  return { ok: true, file: output, sourceCodec, durationSec }
}

async function buildThumbnails(base: Clip, dir: string): Promise<ClipResult> {
  const output = path.join(dir, 'strip.jpg')
  // Lấy dư nửa khung: nếu chia vừa khít thì ô cuối cùng hay bị trống (đen) do làm tròn.
  const rate = `${CLIP_THUMBNAIL_COUNT + 0.5}/${Math.max(base.durationSec, 1).toFixed(3)}`
  const run = await withSlot(() =>
    runFfmpeg(
      // prettier-ignore
      ['-loglevel', 'error',
        // Chỉ giải mã khung khoá: đủ để lấy vài ảnh đại diện mà nhanh hơn hàng chục lần.
        '-skip_frame', 'nokey', '-i', base.file,
        '-vf', `fps=${rate},scale=-2:72,tile=${CLIP_THUMBNAIL_COUNT}x1`,
        '-frames:v', '1', '-q:v', '6', '-y', output],
      COPY_TIMEOUT_MS,
    ),
  )
  if (!run.ok || !(await hasContent(output))) {
    console.error('[clip] thumbnails failed:', run.log.slice(-600))
    return { ok: false, status: 500, error: 'Không tạo được ảnh thu nhỏ.' }
  }
  return { ...base, ok: true, file: output }
}

async function buildDerived(request: ClipRequest, base: Clip, dir: string): Promise<ClipResult> {
  const output = path.join(dir, 'clip.mp4')
  const trim: string[] = []
  // `-ss` đặt trước `-i` để ffmpeg nhảy thẳng tới chỗ cần, không phải đọc từ đầu file.
  if (request.startSec !== undefined) trim.push('-ss', request.startSec.toFixed(3))
  const input = ['-i', base.file]
  const length =
    request.endSec !== undefined ? ['-t', (request.endSec - (request.startSec ?? 0)).toFixed(3)] : []

  let encode: string[]
  if (request.preview) {
    // Bản xem thử: hình nhỏ, nén nhanh nhất có thể, bỏ tiếng.
    encode = ['-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-an']
  } else if (request.codec === 'h264') {
    encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k']
  } else {
    encode = ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
  }
  const transcoding = request.preview || request.codec === 'h264'

  const run = await withSlot(() =>
    runFfmpeg(
      ['-loglevel', 'error', ...trim, ...input, ...length, ...encode, '-movflags', '+faststart', '-y', output],
      transcoding ? TRANSCODE_TIMEOUT_MS : COPY_TIMEOUT_MS,
    ),
  )
  if (!run.ok || !(await hasContent(output))) {
    console.error('[clip] derived failed:', run.log.slice(-600))
    return { ok: false, status: 500, error: 'Không cắt được video. Thử chọn lại đoạn khác.' }
  }
  return { ...base, ok: true, file: output }
}

// ---------------------------------------------------------------- bộ nhớ đệm

function cached(key: string, build: (dir: string) => Promise<ClipResult>): Promise<ClipResult> {
  const existing = cache.get(key)
  if (existing) return existing.result

  if (cache.size >= MAX_CACHED) evict(cache.keys().next().value!)
  const dir = path.join(CACHE_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const result = fsp
    .mkdir(dir, { recursive: true })
    .then(() => build(dir))
    .catch((err): ClipResult => ({ ok: false, status: 500, error: (err as Error).message }))
  cache.set(key, { dir, createdAt: Date.now(), result })
  // Lần hỏng không được nhớ lại: lần sau thử từ đầu.
  void result.then((clip) => !clip.ok && evict(key))
  return result
}

/** Lấy (hoặc tạo) file MP4 cho yêu cầu. Nhiều yêu cầu giống nhau dùng chung một file. */
export async function getClip(request: ClipRequest): Promise<ClipResult> {
  const baseKey = [request.camera.id, request.fromMs, request.toMs].join('|')
  const base = await cached(baseKey, (dir) => buildBase(request, dir))
  if (!base.ok) return base

  if (request.thumbnails) return cached(`${baseKey}|thumbnails`, (dir) => buildThumbnails(base, dir))

  const whole = request.startSec === undefined && request.endSec === undefined
  if (whole && request.codec === 'copy' && !request.preview) return base

  const key = [baseKey, request.startSec ?? '', request.endSec ?? '', request.preview ? 'preview' : request.codec].join('|')
  return cached(key, (dir) => buildDerived(request, base, dir))
}
