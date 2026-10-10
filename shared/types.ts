// Kiểu dữ liệu dùng chung giữa main process, preload và renderer.

export const SEGMENT_MINUTES = [1, 5, 10, 15, 30, 60] as const
export const DEFAULT_RTSP_PORT = 554

/** Tên thư mục con của một camera bên trong thư mục lưu trữ. */
export const CAMERA_FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export type RtspTransport = 'tcp' | 'udp'

export interface CameraConfig {
  id: string
  /** Tên hiển thị do người dùng đặt. */
  name: string
  /** Thư mục con chứa video của camera này, cố định từ lúc tạo. */
  folder: string
  enabled: boolean
  /** Địa chỉ IP (hoặc tên máy) của camera. */
  host: string
  /** Địa chỉ MAC dạng AA:BB:CC:DD:EE:FF, rỗng nếu chưa biết. Dùng để tìm lại camera khi IP đổi. */
  mac: string
  rtspPort: number
  username: string
  password: string
  /** Đường dẫn luồng chính (chất lượng cao), dùng để ghi. Ví dụ `/Streaming/Channels/101`. */
  mainPath: string
  /** Đường dẫn luồng phụ (nhẹ), dùng để xem trực tiếp. Rỗng = dùng luồng chính. */
  subPath: string
  transport: RtspTransport
  recordAudio: boolean
  /** Camera giả lập: phát hình thử do ffmpeg tự tạo, không cần thiết bị thật. Dùng để thử ghi và stream. */
  test: boolean
}

/** Mã kênh, xuất hiện trong đường dẫn máy trạm mở: `/channel/<id>`. */
export const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

/** Một người chơi trên bảng điểm của kênh. */
export interface Player {
  id: string
  name: string
  score: number
}

export const DEFAULT_PLAYER_COUNT = 2

/** Bảng điểm được sửa từ app trên máy chủ hay từ trang ghi điểm của máy trạm. */
export type ScoreSource = 'host' | 'web'

/** Một thay đổi trên bảng điểm. Mỗi dòng xác định bởi thời điểm và người chơi. */
export interface ScoreHistoryEntry {
  timeMs: number
  /** Phiên (trận) mà thay đổi này thuộc về. */
  sessionNo: number
  playerId: string
  /** Tên người chơi lúc thay đổi (sau khi đổi, nếu là đổi tên). */
  playerName: string
  /** `score`: đổi điểm. `add`/`remove`: thêm/xoá người chơi. `rename`: đổi tên. `end`: chốt điểm khi phiên kết thúc. */
  kind: 'score' | 'add' | 'remove' | 'rename' | 'end'
  /** Điểm trước và sau thay đổi. */
  from: number
  to: number
  /** Tên cũ, khi `kind` là `rename`. */
  oldName?: string
  source: ScoreSource
}

export interface ScoreHistoryQuery {
  channelId: string
  /** Chỉ lấy thay đổi trong khoảng [fromMs, toMs). */
  fromMs?: number
  toMs?: number
  playerId?: string
  sessionNo?: number
  /** Số dòng tối đa, tính từ mới nhất. */
  limit?: number
}

/** Một phiên (trận) trên bảng điểm của một kênh: ai đấu với ai, tỉ số, từ lúc nào tới lúc nào. */
export interface ScoreSession {
  sessionNo: number
  /** Thời điểm của thay đổi đầu tiên và cuối cùng trong phiên. */
  startMs: number
  endMs: number
  /** Đã reset bảng điểm để sang phiên khác; chưa thì phiên này đang chơi. */
  ended: boolean
  /** Người chơi và điểm chốt (hoặc điểm hiện tại nếu đang chơi). */
  players: Player[]
}

/** Khoảng thời gian dài nhất cho một lần cắt video để tải về. */
export const CUT_MAX_MS = 30 * 60 * 1000

/** `copy`: giữ nguyên codec của camera. `h264`: chuyển sang H.264 để máy nào cũng phát được. */
export type ClipCodec = 'copy' | 'h264'

/** Một đoạn video đã được máy chủ chuẩn bị xong, sẵn sàng phát hoặc tải. */
export interface ClipInfo {
  /** Đường dẫn phát file; thêm `&download=1` để tải về. */
  url: string
  /** Codec video của camera, vd. `hevc`, `h264`. */
  sourceCodec: string
  sizeBytes: number
  /** Độ dài của cả khoảng xem lại (không phải của đoạn con), tính bằng giây. */
  durationSec: number
}

/** Số khung hình thu nhỏ xếp ngang trên thanh thời gian của trang cắt video. */
export const CLIP_THUMBNAIL_COUNT = 12

/**
 * Các mã QR trên màn hình bảng điểm của kênh: mở bàn (chỉ hiện khi chưa có phiên nào đang chơi),
 * ghi điểm, bill và order, check bill, cắt camera.
 */
export const CHANNEL_QRS = ['open', 'control', 'order', 'bill', 'cut'] as const
export type ChannelQr = (typeof CHANNEL_QRS)[number]

export const DEFAULT_SCORE_COLOR_HIGH = '#ffffff'
export const DEFAULT_SCORE_COLOR_LOW = '#a3a3a3'
/** Màu dạng `#rrggbb`. */
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i
/** Đường dẫn tới trang ở máy chủ khác (order, bill). */
export const EXTERNAL_URL_RE = /^https?:\/\/\S+$/i

/** Một kênh xem: đường dẫn riêng cho máy trạm, hiện các camera được gán và bảng điểm. */
export interface Channel {
  id: string
  name: string
  cameraIds: string[]
  /** Ai có đường dẫn cũng xem được kênh này mà không cần mật khẩu. */
  public: boolean
  /**
   * Mật khẩu riêng của kênh, dùng khi kênh cần mật khẩu. Người nhập mật khẩu này chỉ vào được kênh
   * này. Rỗng = chỉ vào được bằng mật khẩu chung của máy chủ. Máy trạm không bao giờ nhận được giá trị này.
   */
  password: string
  /** Màn hình kênh có chiếu hình camera hay không. Tắt (mặc định) thì chỉ hiện bảng điểm và các mã QR. */
  showVideo: boolean
  /** Đường dẫn trang xem hoá đơn và gọi món của bàn này, hiện thành mã QR trên màn hình kênh. Rỗng = không hiện. */
  orderUrl: string
  /** Đường dẫn trang kiểm tra hoá đơn của bàn này (ở máy chủ khác), hiện thành mã QR. Rỗng = không hiện. */
  billUrl: string
  /** Ẩn toàn bộ mã QR khỏi màn hình kênh, bất kể từng mã đang đặt hiện hay ẩn. */
  hideAllQrs: boolean
  /** Các mã QR bị ẩn riêng khỏi màn hình kênh. */
  hiddenQrs: ChannelQr[]
  /** Màu đèn của điểm cao nhất và của các điểm còn lại trên bảng điểm, dạng `#rrggbb`. */
  scoreColorHigh: string
  scoreColorLow: string
  /** Số thứ tự của phiên (trận) đang chơi, bắt đầu từ 1. Tăng lên mỗi lần reset bảng điểm sau khi đã có điểm. */
  sessionNo: number
  /**
   * Phiên này đã được bấm kết thúc: điểm đã chốt vào lịch sử và bảng điểm đứng yên ở tỉ số cuối,
   * không ghi thêm được cho tới khi mở phiên mới.
   */
  sessionEnded: boolean
  /** Bảng điểm của kênh, do máy chủ quản lý. */
  players: Player[]
}

export type PreviewQuality = 'standard' | 'high'

export interface AppSettings {
  /** Tên quán, hiện ở góc màn hình kênh khi một phiên vừa kết thúc. Rỗng = không hiện. */
  shopName: string
  storageDir: string
  /** Độ dài mỗi file video, tính bằng phút. */
  segmentMinutes: number
  /** Tự xoá video cũ hơn số ngày này. 0 = giữ mãi. */
  retentionDays: number
  autoRecordOnStart: boolean
  /** Độ nét của hình xem trực tiếp: `high` cho màn hình lớn, `standard` cho nhẹ máy. */
  previewQuality: PreviewQuality
  /** Đóng cửa sổ thì ẩn xuống khay hệ thống và tiếp tục ghi, thay vì thoát. */
  minimizeToTray: boolean
  /** Tự mở app (ẩn dưới khay) khi người dùng đăng nhập vào máy. */
  launchAtLogin: boolean
  /** Cho các máy khác trong mạng LAN xem qua trình duyệt. */
  webEnabled: boolean
  webPort: number
  /** Mật khẩu các máy trạm phải nhập. Không bao giờ để trống khi `webEnabled` bật. */
  webPassword: string
  channels: Channel[]
  cameras: CameraConfig[]
}

/** Thiết bị tìm thấy khi quét mạng LAN. */
export interface DiscoveredDevice {
  ip: string
  mac: string
  /** Tên do thiết bị tự báo qua ONVIF, rỗng nếu không có. */
  name: string
  /** Các cổng RTSP đang mở. */
  rtspPorts: number[]
  /** Thiết bị trả lời dò tìm ONVIF (gần như chắc chắn là camera hoặc đầu ghi). */
  onvif: boolean
  /** Đã có trong danh sách camera. */
  known: boolean
}

export interface AddCameraInput {
  /** Địa chỉ IP (kèm `:cổng` nếu cần), địa chỉ MAC, hoặc URL `rtsp://...` đầy đủ. */
  target: string
  username: string
  password: string
  rtspPort?: number
  /** Đường dẫn luồng. Bỏ trống để tự dò theo các hãng phổ biến. */
  path?: string
  name?: string
}

export interface AddCameraResult {
  ok: boolean
  error?: string
  settings?: AppSettings
  camera?: CameraConfig
}

export interface StreamTestResult {
  ok: boolean
  error?: string
  /** Codec video của luồng chính, vd. H264, H265. */
  codec?: string
}

export type RecorderState = 'idle' | 'connecting' | 'recording' | 'error'
export type PreviewState = 'off' | 'connecting' | 'live' | 'error'

export interface CameraStatus {
  /** Người dùng đã bật ghi. Nếu camera đang lỗi thì việc ghi tự tiếp tục khi kết nối lại. */
  recording: boolean
  recorder: RecorderState
  recorderError?: string
  /** Thời điểm bắt đầu phiên ghi hiện tại; trống khi chưa ghi được. */
  recordingSince?: number
  preview: PreviewState
  previewError?: string
}

export type CameraStatusMap = Record<string, CameraStatus>

export interface RecordingSegment {
  /** Đường dẫn tương đối so với thư mục lưu trữ: `<camera>/<YYYY-MM-DD>/<file>`. */
  id: string
  cameraFolder: string
  startMs: number
  endMs: number
  sizeBytes: number
  /** File đang được ghi. */
  inProgress: boolean
  /** URL phát lại qua giao thức `cutcam://`. */
  url: string
}

export interface StorageInfo {
  dir: string
  freeBytes: number
  totalBytes: number
  /** Dung lượng các video CutCam đang chiếm. */
  recordingsBytes: number
  error?: string
}

export const DEFAULT_WEB_PORT = 80

export interface WebServerStatus {
  running: boolean
  port: number
  /** Địa chỉ để máy trạm mở trong trình duyệt, mỗi card mạng một địa chỉ. */
  urls: string[]
  error?: string
}

export interface ListQuery {
  cameraFolder: string
  fromMs: number
  toMs: number
}

type Unsubscribe = () => void

export interface CutCamApi {
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    /** Mở hộp thoại chọn thư mục. Trả về null nếu người dùng huỷ. */
    chooseStorageDir(): Promise<AppSettings | null>
    /** Main process tự đổi cài đặt (vd. camera đổi IP). */
    onChanged(listener: (settings: AppSettings) => void): Unsubscribe
  }
  storage: {
    info(): Promise<StorageInfo>
    openDir(): Promise<void>
  }
  cameras: {
    /** Quét mạng LAN tìm camera. */
    discover(): Promise<DiscoveredDevice[]>
    add(input: AddCameraInput): Promise<AddCameraResult>
    /** Thêm một camera giả lập để thử. */
    addTest(): Promise<AddCameraResult>
    /** Thử kết nối luồng chính của một camera đã lưu. */
    test(cameraId: string): Promise<StreamTestResult>
    status(): Promise<CameraStatusMap>
    onStatus(listener: (status: CameraStatusMap) => void): Unsubscribe
    startRecording(cameraId: string): Promise<void>
    stopRecording(cameraId: string): Promise<void>
    startAll(): Promise<void>
    stopAll(): Promise<void>
    startPreview(cameraId: string): Promise<void>
    stopPreview(cameraId: string): Promise<void>
    /** Khung hình JPEG của luồng xem trực tiếp. */
    onFrame(listener: (cameraId: string, jpeg: Uint8Array) => void): Unsubscribe
  }
  web: {
    status(): Promise<WebServerStatus>
  }
  scores: {
    /** Lịch sử thay đổi bảng điểm của một kênh, mới nhất trước. */
    history(query: ScoreHistoryQuery): Promise<ScoreHistoryEntry[]>
    /** Các phiên đã ghi nhận của một kênh, mới nhất trước. */
    sessions(channelId: string): Promise<ScoreSession[]>
    /** Chốt phiên đang chơi, đưa điểm mọi người về 0 và mở phiên mới. */
    reset(channelId: string): Promise<void>
    /** Kết thúc phiên đang chơi: chốt điểm vào lịch sử và giữ nguyên tỉ số trên bảng tới khi mở phiên mới. */
    end(channelId: string): Promise<void>
    /** Chốt phiên đang chơi rồi mở phiên mới với những người chơi có tên này, ai cũng bắt đầu từ 0 điểm. */
    newSession(channelId: string, names: string[]): Promise<void>
    clearHistory(channelId: string): Promise<void>
  }
  recordings: {
    list(query: ListQuery): Promise<RecordingSegment[]>
    remove(ids: string[]): Promise<number>
    reveal(id: string): Promise<void>
    /** Chép các file đã chọn ra thư mục khác. Trả về số file đã chép, null nếu huỷ. */
    exportTo(ids: string[]): Promise<number | null>
  }
}
