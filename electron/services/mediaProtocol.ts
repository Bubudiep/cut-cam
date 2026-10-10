import { protocol } from 'electron'
import { Readable } from 'node:stream'
import { MEDIA_HOST, MEDIA_LIMIT_PARAM, MEDIA_SCHEME } from '../../shared/ipc'
import { openSegment } from './segmentFile'

/** Phải gọi trước khi app `ready`. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
  ])
}

/** Phục vụ file video trong thư mục lưu trữ cho cửa sổ app qua `cutcam://media/<id>`. */
export function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== MEDIA_HOST) return new Response(null, { status: 404 })

    const id = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const limit = Number(url.searchParams.get(MEDIA_LIMIT_PARAM))
    const { status, headers, stream } = await openSegment(id, request.headers.get('range'), limit)
    const body = stream ? (Readable.toWeb(stream) as ReadableStream) : null
    return new Response(body, { status, headers })
  })
}
