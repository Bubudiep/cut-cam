export const IPC = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseStorageDir: 'settings:choose-storage-dir',
  settingsChanged: 'settings:changed',
  storageInfo: 'storage:info',
  storageOpenDir: 'storage:open-dir',
  camDiscover: 'cameras:discover',
  camAdd: 'cameras:add',
  camAddTest: 'cameras:add-test',
  camTest: 'cameras:test',
  camStatus: 'cameras:status',
  camStatusChanged: 'cameras:status-changed',
  camStartRecording: 'cameras:start-recording',
  camStopRecording: 'cameras:stop-recording',
  camStartAll: 'cameras:start-all',
  camStopAll: 'cameras:stop-all',
  camStartPreview: 'cameras:start-preview',
  camStopPreview: 'cameras:stop-preview',
  camFrame: 'cameras:frame',
  webStatus: 'web:status',
  scoreHistory: 'scores:history',
  scoreSessions: 'scores:sessions',
  scoreReset: 'scores:reset',
  scoreEnd: 'scores:end',
  scoreNewSession: 'scores:new-session',
  scoreClearHistory: 'scores:clear-history',
  recList: 'recordings:list',
  recRemove: 'recordings:remove',
  recReveal: 'recordings:reveal',
  recExport: 'recordings:export',
} as const

export const MEDIA_SCHEME = 'cutcam'
export const MEDIA_HOST = 'media'
export const MEDIA_LIMIT_PARAM = 'limit'

/**
 * `limitBytes` chốt kích thước file tại thời điểm liệt kê. Dùng cho file đang ghi:
 * file vẫn lớn dần, mà trình phát cần mọi phản hồi Range báo cùng một tổng kích thước.
 */
export function mediaUrl(segmentId: string, limitBytes?: number): string {
  const url = `${MEDIA_SCHEME}://${MEDIA_HOST}/${segmentId.split('/').map(encodeURIComponent).join('/')}`
  return limitBytes === undefined ? url : `${url}?${MEDIA_LIMIT_PARAM}=${limitBytes}`
}

// ---------------------------------------------------------------- máy chủ web cho máy trạm

/** Đường dẫn máy trạm mở để xem một kênh. Chấp nhận cả cách viết thiếu chữ n. */
export const CHANNEL_PATH = '/channel/'
export const CHANNEL_PATH_RE = /^\/(?:channel|chanel)\/([^/]+)/
/** Trang cắt video của một camera trong kênh: `/channel/<kênh>/cut/<camera>`. Mã QR trên màn hình kênh trỏ tới đây. */
export const CUT_PATH_RE = /^\/(?:channel|chanel)\/([^/]+)\/cut\/([^/]+)/
export const cutPagePath = (channelId: string, cameraId: string) =>
  `${CHANNEL_PATH}${encodeURIComponent(channelId)}/cut/${encodeURIComponent(cameraId)}`
/** Trang ghi điểm của kênh: `/channel/<kênh>/control`. Mã QR trên màn hình kênh trỏ tới đây. */
export const CONTROL_PATH_RE = /^\/(?:channel|chanel)\/([^/]+)\/control\/?$/
export const controlPagePath = (channelId: string) => `${CHANNEL_PATH}${encodeURIComponent(channelId)}/control`
/** Gắn vào đường dẫn trang ghi điểm để mở sẵn hộp tạo ván mới. Mã QR "Mở bàn" trỏ tới đây. */
export const NEW_SESSION_PARAM = 'new'
export const openTablePath = (channelId: string) => `${controlPagePath(channelId)}?${NEW_SESSION_PARAM}=1`
/** Máy trạm gắn tham số này vào mọi yêu cầu để máy chủ biết nó đang xem kênh nào. */
export const CHANNEL_PARAM = 'channel'

export const WEB_API = {
  session: '/api/session',
  login: '/api/login',
  logout: '/api/logout',
  settings: '/api/settings',
  status: '/api/status',
  recordings: '/api/recordings',
  /** Luồng khung hình của nhiều camera trên một kết nối: `?ids=a,b,c`. */
  live: '/api/live',
  /** File MP4 của một khoảng thời gian: `?cameraId=&fromMs=&toMs=` kèm tuỳ chọn `start`, `end` (giây), `codec`, `preview`, `download`. */
  cut: '/api/cut',
  /** Chuẩn bị file như `cut` nhưng chỉ trả về thông tin (JSON), để giao diện chờ và báo lỗi được. */
  cutInfo: '/api/cut/info',
  /** POST một `ScoreAction` (JSON) để sửa bảng điểm của kênh nêu trong tham số `channel`. Trả về kênh sau khi sửa. */
  score: '/api/score',
  media: '/media/',
} as const

// Khung hình xem trực tiếp gửi cho máy trạm được đóng gói nối tiếp nhau trên một kết nối HTTP:
//
//   [1 byte: độ dài id] [id camera, UTF-8] [4 byte big-endian: độ dài ảnh] [ảnh JPEG]
//
// Gộp chung một kết nối vì trình duyệt chỉ cho mở khoảng 6 kết nối tới cùng một máy chủ,
// không đủ cho mỗi camera một luồng riêng.
export const LIVE_FRAME_LENGTH_BYTES = 4
