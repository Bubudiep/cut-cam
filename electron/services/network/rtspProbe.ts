import { createHash } from 'node:crypto'
import net from 'node:net'

export interface RtspTarget {
  host: string
  port: number
  username: string
  password: string
}

export interface DescribeResult {
  /** Mã trạng thái RTSP; 0 nếu không kết nối được. */
  status: number
  /** Codec video đọc từ SDP, vd. H264. */
  codec?: string
}

const md5 = (text: string) => createHash('md5').update(text).digest('hex')

function buildAuth(header: string, target: RtspTarget, uri: string): string | null {
  const digest = /Digest\s+(.*)/i.exec(header)?.[1]
  if (digest) {
    const realm = /realm="([^"]*)"/i.exec(digest)?.[1] ?? ''
    const nonce = /nonce="([^"]*)"/i.exec(digest)?.[1] ?? ''
    const ha1 = md5(`${target.username}:${realm}:${target.password}`)
    const response = md5(`${ha1}:${nonce}:${md5(`DESCRIBE:${uri}`)}`)
    return `Digest username="${target.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
  }
  if (/Basic/i.test(header)) {
    return `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`
  }
  return null
}

/**
 * Gửi lệnh RTSP DESCRIBE để hỏi camera xem một đường dẫn luồng có tồn tại không.
 * Nhanh hơn nhiều so với chạy thử ffmpeg, và phân biệt được sai mật khẩu (401) với sai đường dẫn (404).
 */
export function describe(target: RtspTarget, path: string, timeoutMs = 4000): Promise<DescribeResult> {
  const uri = `rtsp://${target.host}:${target.port}${path}`
  return new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port })
    let buffer = ''
    let cseq = 0
    let authSent = false
    let settled = false

    const finish = (result: DescribeResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    const send = (auth?: string) => {
      buffer = ''
      const lines = [`DESCRIBE ${uri} RTSP/1.0`, `CSeq: ${++cseq}`, 'User-Agent: CutCam', 'Accept: application/sdp']
      if (auth) lines.push(`Authorization: ${auth}`)
      socket.write(lines.join('\r\n') + '\r\n\r\n')
    }

    socket.setTimeout(timeoutMs, () => finish({ status: 0 }))
    socket.on('error', () => finish({ status: 0 }))
    socket.on('close', () => finish({ status: 0 }))
    socket.on('connect', () => send())
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1')
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const head = buffer.slice(0, headerEnd)
      const bodyLength = Number(/^Content-Length:\s*(\d+)/im.exec(head)?.[1] ?? 0)
      const body = buffer.slice(headerEnd + 4)
      if (body.length < bodyLength) return

      const status = Number(/^RTSP\/\d\.\d\s+(\d{3})/.exec(head)?.[1] ?? 0)
      if (status === 401 && !authSent && target.username) {
        // Camera có thể chào cả Digest lẫn Basic: ưu tiên Digest.
        const challenges = head.split('\r\n').filter((line) => /^WWW-Authenticate:/i.test(line))
        const challenge = challenges.find((line) => /Digest/i.test(line)) ?? challenges[0]
        const auth = challenge && buildAuth(challenge, target, uri)
        if (auth) {
          authSent = true
          send(auth)
          return
        }
      }
      const video = /^m=video[\s\S]*?^a=rtpmap:\d+\s+([A-Za-z0-9-]+)\//m.exec(body)?.[1]
      finish({ status, codec: video?.toUpperCase() })
    })
  })
}

/** Cặp [luồng chính, luồng phụ] của các hãng camera phổ biến. */
const KNOWN_PATHS: [string, string][] = [
  ['/Streaming/Channels/101', '/Streaming/Channels/102'], // Hikvision, Ezviz, HiLook
  ['/cam/realmonitor?channel=1&subtype=0', '/cam/realmonitor?channel=1&subtype=1'], // Dahua, Imou, KBVision
  ['/stream1', '/stream2'], // TP-Link Tapo, VIGI
  ['/h264Preview_01_main', '/h264Preview_01_sub'], // Reolink
  ['/onvif1', '/onvif2'], // Yoosee
  ['/live/ch00_0', '/live/ch00_1'],
  ['/11', '/12'],
  ['/ch0_0.h264', '/ch0_1.h264'],
  ['/videoMain', '/videoSub'], // Foscam
  ['/axis-media/media.amp', ''], // Axis
  ['/live/main', '/live/sub'],
  ['/h264_stream', ''],
  ['/live', ''],
  ['/1', '/2'],
  ['/', ''],
]

export type DetectResult =
  | { ok: true; mainPath: string; subPath: string; codec?: string }
  | { ok: false; reason: 'unreachable' | 'auth' | 'not-found' }

/** Thử lần lượt các đường dẫn luồng quen thuộc cho tới khi camera chấp nhận. */
export async function detectPaths(target: RtspTarget): Promise<DetectResult> {
  for (const [mainPath, candidateSub] of KNOWN_PATHS) {
    const main = await describe(target, mainPath)
    if (main.status === 0) return { ok: false, reason: 'unreachable' }
    if (main.status === 401 || main.status === 403) return { ok: false, reason: 'auth' }
    if (main.status !== 200) continue
    const subOk = candidateSub !== '' && (await describe(target, candidateSub)).status === 200
    return { ok: true, mainPath, subPath: subOk ? candidateSub : '', codec: main.codec }
  }
  return { ok: false, reason: 'not-found' }
}
