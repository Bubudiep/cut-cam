import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { resolveSegment } from './recordingStore'
import { getSettings } from './settingsStore'

const CONTENT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg' }

export interface FileResponse {
  status: number
  headers: Record<string, string>
  /** Không có khi phản hồi không kèm nội dung (lỗi, hoặc file rỗng). */
  stream?: fs.ReadStream
}

/**
 * Mở một file video để phát, có hỗ trợ header Range. Trình phát cần Range để tua, và Safari trên
 * iPhone từ chối phát hẳn nếu máy chủ không hỗ trợ.
 *
 * `limitBytes` > 0 chốt kích thước file (dùng cho file đang ghi, xem `mediaUrl`).
 */
export async function openFile(
  file: string,
  rangeHeader: string | null | undefined,
  limitBytes = 0,
): Promise<FileResponse> {
  let size: number
  try {
    size = (await fsp.stat(file)).size
  } catch {
    return { status: 404, headers: {} }
  }
  if (limitBytes > 0) size = Math.min(size, limitBytes)

  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'video/mp4',
    'Accept-Ranges': 'bytes',
  }
  if (size === 0) return { status: 200, headers }

  let start = 0
  let end = size - 1
  let status = 200
  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '')
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1])
      if (range[2]) end = Math.min(Number(range[2]), size - 1)
    } else {
      start = Math.max(0, size - Number(range[2]))
    }
    if (start > end) {
      headers['Content-Range'] = `bytes */${size}`
      return { status: 416, headers }
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = String(end - start + 1)
  return { status, headers, stream: fs.createReadStream(file, { start, end }) }
}

/**
 * Mở một file ghi hình trong thư mục lưu trữ theo id của nó.
 * Dùng chung cho giao thức `cutcam://` của cửa sổ app và máy chủ web cho các máy trạm.
 */
export async function openSegment(
  id: string,
  rangeHeader: string | null | undefined,
  limitBytes: number,
): Promise<FileResponse> {
  const file = resolveSegment(getSettings().storageDir, id)
  if (!file) return { status: 403, headers: {} }
  return openFile(file, rangeHeader, limitBytes)
}
