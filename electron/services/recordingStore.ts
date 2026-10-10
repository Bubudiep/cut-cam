import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { mediaUrl } from '../../shared/ipc'
import {
  CAMERA_FOLDER_RE,
  type ListQuery,
  type RecordingSegment,
  type StorageInfo,
} from '../../shared/types'

// Cấu trúc trên đĩa:
//
//   <storageDir>/<camera>/<YYYY-MM-DD>/<HH-mm-ss>.rec.mp4          đang ghi
//   <storageDir>/<camera>/<YYYY-MM-DD>/<HH-mm-ss>__<HH-mm-ss>.mp4  đã xong (bắt đầu__kết thúc)
//
// Thời gian nằm ngay trong tên file nên không cần cơ sở dữ liệu: quét thư mục là đủ.

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const FILE_RE = /^(\d{2})-(\d{2})-(\d{2})(?:__(\d{2})-(\d{2})-(\d{2})|\.rec)\.(?:mp4|webm)$/
/** Tách file đang ghi thành [phần trước `.rec`, đuôi file]. */
const REC_RE = /^(.*)\.rec\.(mp4|webm)$/
const DAY_MS = 24 * 60 * 60 * 1000

/** Đường dẫn tuyệt đối của các file ffmpeg đang ghi. */
const active = new Set<string>()

const pad = (n: number) => String(n).padStart(2, '0')
const dayName = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const clockName = (d: Date) => `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`

function assertFolder(folder: string) {
  if (!CAMERA_FOLDER_RE.test(folder)) throw new Error(`Tên thư mục camera không hợp lệ: ${folder}`)
}

/** Trả về đường dẫn tuyệt đối của một segment, hoặc null nếu id trỏ ra ngoài thư mục lưu trữ. */
export function resolveSegment(root: string, id: string): string | null {
  const full = path.resolve(root, id)
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!FILE_RE.test(path.basename(full))) return null
  return full
}

const isOpen = (filePath: string) => active.has(path.normalize(filePath))

// ---------------------------------------------------------------- ghi
//
// ffmpeg tự tạo và ghi các file `.rec.mp4`. Dịch vụ camera báo cho store biết file nào
// đang mở (để không ai xoá hay đổi tên nó) và file nào vừa xong.

/** Tạo sẵn thư mục ngày hôm nay và ngày mai của một camera, vì ffmpeg không tự tạo thư mục. */
export function ensureDayDirs(root: string, cameraFolder: string) {
  assertFolder(cameraFolder)
  const day = new Date()
  for (let i = 0; i < 2; i++) {
    fs.mkdirSync(path.join(root, cameraFolder, dayName(day)), { recursive: true })
    day.setDate(day.getDate() + 1)
  }
}

export function markActive(filePath: string) {
  active.add(path.normalize(filePath))
}

/** Đổi tên file vừa ghi xong: `<bắt đầu>.rec.mp4` -> `<bắt đầu>__<kết thúc>.mp4`. File rỗng thì xoá. */
export function finalizeFile(filePath: string, endMs: number) {
  const file = path.normalize(filePath)
  active.delete(file)
  const match = REC_RE.exec(file)
  if (!match) return
  try {
    if (fs.statSync(file).size === 0) {
      fs.rmSync(file, { force: true })
      return
    }
    fs.renameSync(file, `${match[1]}__${clockName(new Date(endMs))}.${match[2]}`)
  } catch (err) {
    // Sót lại thì lần mở app sau `recoverOrphans` sẽ xử lý.
    console.error('[recordings] finalize failed', file, err)
  }
}

// ---------------------------------------------------------------- đọc

async function readDirs(dir: string, pattern: RegExp): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && pattern.test(e.name)).map((e) => e.name)
  } catch {
    return []
  }
}

function parseSegment(
  cameraFolder: string,
  day: string,
  file: string,
  stat: fs.Stats,
): RecordingSegment | null {
  const d = DAY_RE.exec(day)
  const f = FILE_RE.exec(file)
  if (!d || !f) return null
  const at = (h: string, m: string, s: string) =>
    new Date(+d[1], +d[2] - 1, +d[3], +h, +m, +s).getTime()
  const startMs = at(f[1], f[2], f[3])
  const inProgress = f[4] === undefined
  let endMs: number
  if (inProgress) {
    endMs = Math.max(stat.mtimeMs, startMs + 1000)
  } else {
    endMs = at(f[4], f[5], f[6])
    // Segment vắt qua nửa đêm.
    if (endMs <= startMs) endMs += DAY_MS
  }
  const id = `${cameraFolder}/${day}/${file}`
  const url = mediaUrl(id, inProgress ? stat.size : undefined)
  return { id, cameraFolder, startMs, endMs, sizeBytes: stat.size, inProgress, url }
}

async function readDay(root: string, cameraFolder: string, day: string) {
  const dir = path.join(root, cameraFolder, day)
  let files: string[]
  try {
    files = await fsp.readdir(dir)
  } catch {
    return []
  }
  const segments: RecordingSegment[] = []
  for (const file of files) {
    if (!FILE_RE.test(file)) continue
    try {
      const seg = parseSegment(cameraFolder, day, file, await fsp.stat(path.join(dir, file)))
      if (seg) segments.push(seg)
    } catch {
      // File vừa bị đổi tên hoặc xoá giữa chừng.
    }
  }
  return segments
}

export async function list(root: string, query: ListQuery): Promise<RecordingSegment[]> {
  assertFolder(query.cameraFolder)
  const { fromMs, toMs } = query
  if (!(fromMs < toMs)) return []

  const result: RecordingSegment[] = []
  // Lùi một ngày để bắt được segment bắt đầu trước nửa đêm.
  const cursor = new Date(fromMs - DAY_MS)
  cursor.setHours(0, 0, 0, 0)
  for (; cursor.getTime() < toMs; cursor.setDate(cursor.getDate() + 1)) {
    for (const seg of await readDay(root, query.cameraFolder, dayName(cursor))) {
      if (seg.endMs > fromMs && seg.startMs < toMs) result.push(seg)
    }
  }
  return result.sort((a, b) => a.startMs - b.startMs)
}

// ---------------------------------------------------------------- quản lý

async function removeIfEmpty(dir: string) {
  try {
    await fsp.rmdir(dir)
  } catch {
    // Còn file bên trong.
  }
}

export async function remove(root: string, ids: string[]): Promise<number> {
  let removed = 0
  for (const id of ids) {
    const file = resolveSegment(root, id)
    if (!file || isOpen(file)) continue
    try {
      await fsp.rm(file)
      removed++
      await removeIfEmpty(path.dirname(file))
    } catch (err) {
      console.error('[recordings] remove failed', id, err)
    }
  }
  return removed
}

export async function exportTo(root: string, ids: string[], destDir: string): Promise<number> {
  let copied = 0
  for (const id of ids) {
    const file = resolveSegment(root, id)
    if (!file) continue
    await fsp.copyFile(file, path.join(destDir, id.split('/').join('_')))
    copied++
  }
  return copied
}

/** Sau khi app bị tắt đột ngột: đổi tên các file `.rec.mp4` bỏ dở thành file hoàn chỉnh. */
export async function recoverOrphans(root: string) {
  for (const camera of await readDirs(root, CAMERA_FOLDER_RE)) {
    for (const day of await readDirs(path.join(root, camera), DAY_RE)) {
      const dir = path.join(root, camera, day)
      for (const file of await fsp.readdir(dir).catch(() => [] as string[])) {
        const filePath = path.join(dir, file)
        if (!REC_RE.test(file) || !FILE_RE.test(file) || isOpen(filePath)) continue
        try {
          const stat = await fsp.stat(filePath)
          const seg = parseSegment(camera, day, file, stat)
          if (seg) finalizeFile(filePath, seg.endMs)
        } catch (err) {
          console.error('[recordings] recover failed', filePath, err)
        }
      }
    }
  }
}

/** Xoá video cũ hơn `days` ngày của các camera đã cho. */
export async function applyRetention(root: string, cameraFolders: string[], days: number) {
  if (days <= 0) return
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDay = dayName(cutoff)

  for (const camera of cameraFolders) {
    if (!CAMERA_FOLDER_RE.test(camera)) continue
    for (const day of await readDirs(path.join(root, camera), DAY_RE)) {
      if (day >= cutoffDay) continue
      const dir = path.join(root, camera, day)
      for (const file of await fsp.readdir(dir).catch(() => [] as string[])) {
        const filePath = path.join(dir, file)
        if (FILE_RE.test(file) && !isOpen(filePath)) await fsp.rm(filePath, { force: true })
      }
      await removeIfEmpty(dir)
    }
  }
}

export async function storageInfo(root: string): Promise<StorageInfo> {
  const info: StorageInfo = { dir: root, freeBytes: 0, totalBytes: 0, recordingsBytes: 0 }
  try {
    await fsp.mkdir(root, { recursive: true })
    const stat = await fsp.statfs(root)
    info.freeBytes = stat.bavail * stat.bsize
    info.totalBytes = stat.blocks * stat.bsize
  } catch (err) {
    info.error = (err as Error).message
    return info
  }
  for (const camera of await readDirs(root, CAMERA_FOLDER_RE)) {
    for (const day of await readDirs(path.join(root, camera), DAY_RE)) {
      for (const seg of await readDay(root, camera, day)) info.recordingsBytes += seg.sizeBytes
    }
  }
  return info
}
