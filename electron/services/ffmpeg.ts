import ffmpegStatic from 'ffmpeg-static'
import type { CameraConfig } from '../../shared/types'

/** Trong bản đóng gói, file thực thi nằm ngoài app.asar (xem `asarUnpack` trong electron-builder.json5). */
export const ffmpegPath = String(ffmpegStatic).replace('app.asar', 'app.asar.unpacked')

/** Camera ngừng gửi dữ liệu quá lâu thì ffmpeg tự thoát, để dịch vụ kết nối lại. Đơn vị: micro giây. */
const SOCKET_TIMEOUT_US = 10_000_000

export function rtspUrl(camera: CameraConfig, stream: 'main' | 'sub'): string {
  const path = (stream === 'sub' && camera.subPath) || camera.mainPath || '/'
  const auth = camera.username
    ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@`
    : ''
  return `rtsp://${auth}${camera.host}:${camera.rtspPort}${path.startsWith('/') ? path : `/${path}`}`
}

const TEST_FRAME_RATE = 25
const TEST_SIZE = { main: '1280x720', sub: '640x360' }

/** Tham số đầu vào của ffmpeg cho một camera: luồng RTSP thật, hoặc hình thử tự tạo với camera giả lập. */
export function cameraInputArgs(camera: CameraConfig, stream: 'main' | 'sub'): string[] {
  if (camera.test) {
    // `-re` phát đúng tốc độ thời gian thực như một camera thật; hình thử có sẵn đồng hồ chạy.
    return [
      '-hide_banner',
      '-nostats',
      '-re',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${TEST_SIZE[stream]}:rate=${TEST_FRAME_RATE}`,
    ]
  }
  return [
    '-hide_banner',
    '-nostats',
    '-rtsp_transport',
    camera.transport,
    '-timeout',
    String(SOCKET_TIMEOUT_US),
    '-i',
    rtspUrl(camera, stream),
  ]
}

/**
 * Cách đưa hình vào file ghi. Camera thật gửi sẵn video đã nén nên chỉ việc chép; hình thử là
 * ảnh thô nên phải nén H.264, với khung khoá mỗi 2 giây để cắt file được đúng mốc.
 */
export function recordVideoArgs(camera: CameraConfig): string[] {
  if (!camera.test) return ['-c:v', 'copy']
  return [
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(TEST_FRAME_RATE * 2),
    '-b:v',
    '1500k',
  ]
}

/** Che mật khẩu trước khi đưa thông báo lỗi của ffmpeg ra giao diện. */
export function redact(text: string): string {
  return text.replace(/(rtsp:\/\/)[^@\s/]+@/gi, '$1***@')
}
