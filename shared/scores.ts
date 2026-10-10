import type { Player } from './types'

/** Số người chơi nhiều nhất trên một bảng điểm: quá số này thì màn hình không còn chỗ hiện. */
export const MAX_PLAYERS = 8
export const PLAYER_NAME_MAX = 24
export const SCORE_MIN = -9999
export const SCORE_MAX = 99999

/**
 * Một thao tác trên bảng điểm. Gửi thao tác chứ không gửi cả bảng điểm: hai điện thoại bấm cùng
 * lúc thì máy chủ cộng dồn cả hai, không cái nào đè mất cái nào.
 */
export type ScoreAction =
  | { op: 'adjust'; playerId: string; delta: number }
  | { op: 'set'; playerId: string; score: number }
  | { op: 'rename'; playerId: string; name: string }
  | { op: 'add' }
  | { op: 'remove'; playerId: string }
  | { op: 'reset' }
  /** Kết thúc phiên đang chơi: chốt điểm, bảng điểm đứng yên ở tỉ số cuối. */
  | { op: 'end' }
  /** Mở phiên mới với những người chơi này, ai cũng bắt đầu từ 0 điểm. */
  | { op: 'session'; names: string[] }

const clampScore = (value: number) => Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(value)))

/** Không dùng `crypto.randomUUID`: trình duyệt chỉ cho gọi nó trên trang HTTPS, mà máy trạm mở bằng HTTP. */
const newPlayerId = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0')

/** Kiểm tra và làm sạch danh sách tên của phiên mới. Trả về null nếu không hợp lệ. */
export function sessionNames(names: unknown): string[] | null {
  if (!Array.isArray(names) || names.length < 1 || names.length > MAX_PLAYERS) return null
  return names.map((name, i) => (typeof name === 'string' ? name.trim().slice(0, PLAYER_NAME_MAX) : '') || `Người chơi ${i + 1}`)
}

/**
 * Trả về bảng điểm sau thao tác, hoặc null nếu thao tác không hợp lệ. Kết thúc phiên (`end`) và mở
 * phiên mới (`session`) không làm ở đây: chúng còn phải chốt điểm vào lịch sử, việc đó chỉ máy chủ làm được.
 *
 * Dữ liệu gửi từ máy trạm nên phải kiểm tra kỹ.
 */
/** Những thao tác đổi bảng điểm, bị khoá khi phiên đã kết thúc (đổi tên thì vẫn được). */
export const LOCKED_WHEN_ENDED: ScoreAction['op'][] = ['adjust', 'set', 'add', 'remove']

export function applyScoreAction(players: Player[], action: ScoreAction): Player[] | null {
  const patch = (id: unknown, change: (player: Player) => Player) =>
    players.some((p) => p.id === id) ? players.map((p) => (p.id === id ? change(p) : p)) : null

  switch (action?.op) {
    case 'adjust': {
      const delta = Number(action.delta)
      if (!Number.isFinite(delta)) return null
      return patch(action.playerId, (p) => ({ ...p, score: clampScore(p.score + delta) }))
    }
    case 'set': {
      const score = Number(action.score)
      if (!Number.isFinite(score)) return null
      return patch(action.playerId, (p) => ({ ...p, score: clampScore(score) }))
    }
    case 'rename': {
      const name = typeof action.name === 'string' ? action.name.trim().slice(0, PLAYER_NAME_MAX) : ''
      if (!name) return null
      return patch(action.playerId, (p) => ({ ...p, name }))
    }
    case 'add':
      if (players.length >= MAX_PLAYERS) return null
      return [...players, { id: newPlayerId(), name: `Người chơi ${players.length + 1}`, score: 0 }]
    case 'remove':
      return players.some((p) => p.id === action.playerId) ? players.filter((p) => p.id !== action.playerId) : null
    case 'reset':
      return players.map((p) => ({ ...p, score: 0 }))
    default:
      return null
  }
}
