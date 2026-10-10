import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  CHANNEL_ID_RE,
  type AppSettings,
  type Channel,
  type Player,
  type ScoreHistoryEntry,
  type ScoreHistoryQuery,
  type ScoreSession,
  type ScoreSource,
} from '../../shared/types'
import { getSettings, updateSettings } from './settingsStore'

// Lịch sử thay đổi bảng điểm. Mỗi kênh một file, mỗi dòng một thay đổi (JSON), chỉ ghi nối thêm
// vào cuối: bấm điểm liên tục cũng không phải ghi lại cả file, và mất điện giữa chừng thì cùng lắm
// hỏng dòng cuối.
//
// Các thay đổi được gom theo phiên: một phiên là một trận giữa những người đang có tên trên bảng,
// kéo dài tới khi bảng điểm được reset. Lúc reset, điểm chốt của từng người được ghi lại thành
// dòng `end`, rồi kênh chuyển sang phiên kế tiếp.

/** File của một kênh to quá mức này thì cắt bớt phần cũ nhất. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Số dòng giữ lại sau khi cắt. */
const KEEP_LINES = 8000
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 5000

const historyDir = () => path.join(app.getPath('userData'), 'score-history')

/** Mã kênh đã được kiểm tra chỉ gồm chữ thường, số và gạch nối, nên dùng làm tên file được. */
function historyFile(channelId: string): string | null {
  return CHANNEL_ID_RE.test(channelId) ? path.join(historyDir(), `${channelId}.jsonl`) : null
}

/** So bảng điểm của một kênh trước và sau khi sửa, trả về từng thay đổi theo từng người chơi. */
function diffPlayers(before: Channel, after: Channel, timeMs: number, source: ScoreSource): ScoreHistoryEntry[] {
  const entries: ScoreHistoryEntry[] = []
  const old = new Map(before.players.map((p) => [p.id, p]))
  const common = { timeMs, sessionNo: after.sessionNo, source }
  for (const player of after.players) {
    const was = old.get(player.id)
    old.delete(player.id)
    const base = { ...common, playerId: player.id, playerName: player.name }
    if (!was) {
      entries.push({ ...base, kind: 'add', from: 0, to: player.score })
      continue
    }
    if (was.name !== player.name) entries.push({ ...base, kind: 'rename', from: was.score, to: was.score, oldName: was.name })
    if (was.score !== player.score) entries.push({ ...base, kind: 'score', from: was.score, to: player.score })
  }
  for (const gone of old.values()) {
    entries.push({ ...common, playerId: gone.id, playerName: gone.name, kind: 'remove', from: gone.score, to: gone.score })
  }
  return entries
}

function append(channelId: string, entries: ScoreHistoryEntry[]) {
  const file = historyFile(channelId)
  if (!file || !entries.length) return
  try {
    fs.mkdirSync(historyDir(), { recursive: true })
    fs.appendFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    if (fs.statSync(file).size > MAX_FILE_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, lines.slice(-KEEP_LINES).join('\n') + '\n')
      fs.renameSync(tmp, file)
    }
  } catch (err) {
    // Không ghi được lịch sử thì việc ghi điểm vẫn phải thành công.
    console.error('[score-history]', err)
  }
}

/** Đọc mọi dòng của một kênh theo thứ tự ghi (cũ trước). Dòng ghi dở lúc mất điện thì bỏ qua. */
function readAll(channelId: string): ScoreHistoryEntry[] {
  const file = historyFile(channelId)
  if (!file || !fs.existsSync(file)) return []
  const entries: ScoreHistoryEntry[] = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const entry = JSON.parse(line) as ScoreHistoryEntry
      // Dòng ghi từ trước khi có phiên: coi như thuộc phiên đầu tiên.
      entries.push({ ...entry, sessionNo: entry.sessionNo ?? 1 })
    } catch {
      continue
    }
  }
  return entries
}

/**
 * Ghi lại những gì đã đổi trên bảng điểm giữa hai bản cài đặt. Gọi ở mọi chỗ sửa kênh: cả máy chủ
 * lẫn máy trạm đều đi qua đây. Kênh mới tạo hoặc bị xoá thì không ghi gì.
 */
export function recordScoreChanges(before: Channel[], after: Channel[], source: ScoreSource) {
  const timeMs = Date.now()
  for (const channel of after) {
    const previous = before.find((c) => c.id === channel.id)
    // Phiên đã kết thúc thì điểm đã chốt: những gì sửa sau đó (vd. đổi tên cho khách kế tiếp) không thuộc về nó.
    if (previous && !previous.sessionEnded) append(channel.id, diffPlayers(previous, channel, timeMs, source))
  }
}

/** Ghi điểm chốt của từng người chơi vào lịch sử, đánh dấu phiên đang chơi đã xong. */
function writeFinalScores(channel: Channel, source: ScoreSource) {
  const timeMs = Date.now()
  append(
    channel.id,
    channel.players.map((p) => ({
      timeMs,
      sessionNo: channel.sessionNo,
      playerId: p.id,
      playerName: p.name,
      kind: 'end',
      from: p.score,
      to: p.score,
      source,
    })),
  )
}

const hasScores = (channel: Channel) => channel.players.some((p) => p.score !== 0)

/**
 * Kết thúc phiên đang chơi của một kênh mà chưa mở phiên mới: chốt điểm từng người vào lịch sử và
 * để bảng điểm đứng yên ở tỉ số cuối, cho người chơi còn nhìn thấy kết quả. Bảng đang toàn 0, hoặc
 * phiên đã kết thúc rồi, thì không có gì để làm.
 * Trả về cài đặt sau khi sửa, hoặc null nếu không có kênh đó.
 */
export function endSession(channelId: string, source: ScoreSource): AppSettings | null {
  const settings = getSettings()
  const channel = settings.channels.find((c) => c.id === channelId)
  if (!channel) return null
  if (channel.sessionEnded || !hasScores(channel)) return settings
  writeFinalScores(channel, source)
  return updateSettings({ channels: settings.channels.map((c) => (c === channel ? { ...c, sessionEnded: true } : c)) })
}

/**
 * Mở phiên mới cho một kênh, mọi người bắt đầu từ 0. Phiên đang chơi mà chưa bấm kết thúc thì
 * được chốt điểm vào lịch sử trước. Có `names` thì phiên mới chơi với đúng những người đó (số
 * người và tên), không thì giữ nguyên người chơi. Bảng đang toàn 0 thì chưa có trận nào để chốt,
 * nên giữ nguyên số phiên.
 * Trả về cài đặt sau khi sửa, hoặc null nếu không có kênh đó.
 */
export function startSession(channelId: string, source: ScoreSource, names?: string[]): AppSettings | null {
  const { channels } = getSettings()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) return null
  const played = channel.sessionEnded || hasScores(channel)
  if (!channel.sessionEnded && played) writeFinalScores(channel, source)
  return updateSettings({
    channels: channels.map((c) =>
      c === channel
        ? { ...c, sessionNo: c.sessionNo + (played ? 1 : 0), sessionEnded: false, players: nextPlayers(c.players, names) }
        : c,
    ),
  })
}

/** Người chơi của phiên mới, ai cũng 0 điểm. */
function nextPlayers(current: Player[], names?: string[]): Player[] {
  if (!names) return current.map((p) => ({ ...p, score: 0 }))
  const used = new Set<string>()
  return names.map((name, index) => {
    // Cùng chỗ, cùng tên thì vẫn là người đó: giữ mã để lọc lịch sử theo người chơi xuyên các phiên.
    let id = current[index]?.name === name ? current[index].id : randomBytes(4).toString('hex')
    while (used.has(id)) id = randomBytes(4).toString('hex')
    used.add(id)
    return { id, name, score: 0 }
  })
}

/** Các thay đổi của một kênh, mới nhất trước, lọc theo phiên, khoảng thời gian và người chơi nếu có. */
export function listScoreHistory(query: ScoreHistoryQuery): ScoreHistoryEntry[] {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(query?.limit)) || DEFAULT_LIMIT))
  const fromMs = Number(query?.fromMs ?? -Infinity)
  const toMs = Number(query?.toMs ?? Infinity)
  const all = readAll(String(query?.channelId ?? ''))
  const entries: ScoreHistoryEntry[] = []
  for (let i = all.length - 1; i >= 0 && entries.length < limit; i--) {
    const entry = all[i]
    if (entry.timeMs < fromMs || entry.timeMs >= toMs) continue
    if (query.playerId && entry.playerId !== query.playerId) continue
    if (query.sessionNo !== undefined && entry.sessionNo !== query.sessionNo) continue
    entries.push(entry)
  }
  return entries
}

/** Các phiên đã ghi nhận của một kênh, mới nhất trước: ai đấu với ai, tỉ số, từ lúc nào tới lúc nào. */
export function listScoreSessions(channelId: string): ScoreSession[] {
  const current = getSettings().channels.find((c) => c.id === channelId)
  const sessions = new Map<number, { session: ScoreSession; names: Map<string, string> }>()
  for (const entry of readAll(String(channelId))) {
    let item = sessions.get(entry.sessionNo)
    if (!item) {
      item = {
        session: { sessionNo: entry.sessionNo, startMs: entry.timeMs, endMs: entry.timeMs, ended: false, players: [] },
        names: new Map(),
      }
      sessions.set(entry.sessionNo, item)
    }
    const { session, names } = item
    session.endMs = Math.max(session.endMs, entry.timeMs)
    // Tên lúc ghi điểm là tên của người thực sự đã chơi phiên này; tên trên dòng chốt có thể đã
    // bị đổi sang khách kế tiếp ngay trước khi reset.
    if (entry.kind === 'score') names.set(entry.playerId, entry.playerName)
    if (entry.kind === 'remove') {
      session.players = session.players.filter((p) => p.id !== entry.playerId)
      continue
    }
    if (entry.kind === 'end') session.ended = true
    const player = session.players.find((p) => p.id === entry.playerId)
    if (player) Object.assign(player, { name: entry.playerName, score: entry.to })
    else session.players.push({ id: entry.playerId, name: entry.playerName, score: entry.to })
  }

  return [...sessions.values()]
    .map(({ session, names }) => {
      // Phiên đang chơi: lấy thẳng bảng điểm hiện tại, gồm cả người chưa ghi điểm nào.
      if (!session.ended && current && session.sessionNo === current.sessionNo) {
        return { ...session, players: current.players.map((p) => ({ ...p })) }
      }
      return { ...session, players: session.players.map((p) => ({ ...p, name: names.get(p.id) ?? p.name })) }
    })
    .sort((a, b) => b.sessionNo - a.sessionNo)
}

export function clearScoreHistory(channelId: string) {
  const file = historyFile(String(channelId))
  if (file) fs.rmSync(file, { force: true })
}
