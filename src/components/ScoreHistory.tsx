import { Button, DatePicker, Popconfirm, Select, Table, Tag, Tooltip } from 'antd'
import type { Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LuFlag, LuHistory, LuMonitor, LuRefreshCw, LuSmartphone, LuTrash2 } from 'react-icons/lu'
import type { Channel, ScoreHistoryEntry, ScoreSession } from '../../shared/types'
import { foldText, formatClock, formatDate } from '../utils/format'

const DAY_MS = 24 * 60 * 60 * 1000

/** "An 12 – 9 Bình": ai đấu với ai và tỉ số của một phiên. */
const matchup = (session: ScoreSession) =>
  session.players.length === 2
    ? `${session.players[0].name} ${session.players[0].score} – ${session.players[1].score} ${session.players[1].name}`
    : session.players.map((p) => `${p.name} ${p.score}`).join(' · ')

const sessionLabel = (session: ScoreSession) =>
  `Phiên ${session.sessionNo} · ${matchup(session)} · ${formatDate(session.startMs)} ${formatClock(session.startMs, false)}${
    session.ended ? '' : ' · đang chơi'
  }`

/** Mô tả một thay đổi: điểm cũ → điểm mới kèm mức chênh, hoặc việc thêm/xoá/đổi tên người chơi. */
export function ScoreChange({ entry }: { entry: ScoreHistoryEntry }) {
  if (entry.kind === 'add') return <span className="text-muted">Thêm người chơi</span>
  if (entry.kind === 'remove') return <span className="text-muted">Xoá người chơi (đang {entry.from} điểm)</span>
  if (entry.kind === 'rename') return <span className="text-muted">Đổi tên từ “{entry.oldName}”</span>
  if (entry.kind === 'end') {
    return (
      <span className="flex items-center gap-1.5">
        <LuFlag className="text-amber-400" /> Kết thúc phiên với <b className="tabular-nums">{entry.to}</b> điểm
      </span>
    )
  }
  const delta = entry.to - entry.from
  return (
    <span className="tabular-nums">
      {entry.from} → <b>{entry.to}</b>{' '}
      <Tag className="ml-1" color={delta > 0 ? 'green' : 'red'} bordered={false}>
        {delta > 0 ? `+${delta}` : delta}
      </Tag>
    </span>
  )
}

/**
 * Lịch sử thay đổi bảng điểm của một kênh: mỗi dòng là một lần đổi của một người chơi tại một
 * thời điểm, gom theo phiên (trận). Tìm được theo phiên, và lọc theo ngày, theo người chơi.
 */
export function ScoreHistory({ channel }: { channel: Channel }) {
  const [entries, setEntries] = useState<ScoreHistoryEntry[]>([])
  const [sessions, setSessions] = useState<ScoreSession[]>([])
  const [loading, setLoading] = useState(false)
  const [day, setDay] = useState<Dayjs | null>(null)
  const [playerId, setPlayerId] = useState<string>()
  const [sessionNo, setSessionNo] = useState<number>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fromMs = day?.startOf('day').valueOf()
      const [history, list] = await Promise.all([
        window.cutcam.scores.history({
          channelId: channel.id,
          sessionNo,
          playerId,
          fromMs,
          toMs: fromMs === undefined ? undefined : fromMs + DAY_MS,
        }),
        window.cutcam.scores.sessions(channel.id),
      ])
      setEntries(history)
      setSessions(list)
    } finally {
      setLoading(false)
    }
  }, [channel.id, day, playerId, sessionNo])

  // Bảng điểm vừa đổi (ở đây hoặc từ điện thoại) thì lịch sử cũng vừa có thêm dòng mới.
  useEffect(() => {
    void load()
  }, [load, channel.players])

  // Người đã bị xoá khỏi bảng điểm vẫn còn trong lịch sử: cho lọc theo cả họ.
  const playerOptions = useMemo(() => {
    const names = new Map(channel.players.map((p) => [p.id, p.name]))
    for (const entry of entries) if (!names.has(entry.playerId)) names.set(entry.playerId, `${entry.playerName} (đã xoá)`)
    return [...names].map(([value, label]) => ({ value, label }))
  }, [channel.players, entries])

  const sessionOptions = useMemo(
    () => sessions.map((session) => ({ value: session.sessionNo, label: sessionLabel(session) })),
    [sessions],
  )
  const selectedSession = sessions.find((s) => s.sessionNo === sessionNo)

  const clear = async () => {
    await window.cutcam.scores.clearHistory(channel.id)
    setSessionNo(undefined)
    await load()
  }

  return (
    <section className="score-history flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 mr-auto flex items-center gap-2 text-sm font-semibold">
          <LuHistory /> Lịch sử điểm · {channel.name}
          <span className="font-normal text-muted">· {channel.sessionEnded ? `phiên ${channel.sessionNo} đã kết thúc` : `đang ở phiên ${channel.sessionNo}`}</span>
        </h2>
        <Select
          className="history-session w-80"
          allowClear
          showSearch
          placeholder="Tìm phiên: số phiên, tên người chơi, ngày…"
          value={sessionNo}
          onChange={setSessionNo}
          options={sessionOptions}
          filterOption={(input, option) => foldText(String(option?.label ?? '')).includes(foldText(input))}
          notFoundContent="Không có phiên nào khớp"
          popupMatchSelectWidth={false}
        />
        <DatePicker value={day} onChange={setDay} placeholder="Mọi ngày" format="DD/MM/YYYY" />
        <Select
          className="w-40"
          allowClear
          placeholder="Mọi người chơi"
          value={playerId}
          onChange={setPlayerId}
          options={playerOptions}
        />
        <Tooltip title="Tải lại">
          <Button icon={<LuRefreshCw />} onClick={() => void load()} />
        </Tooltip>
        <Popconfirm
          title={`Xoá toàn bộ lịch sử điểm của ${channel.name}?`}
          description="Xoá mọi phiên, không khôi phục lại được."
          okText="Xoá"
          okButtonProps={{ danger: true }}
          onConfirm={clear}
        >
          <Button danger icon={<LuTrash2 />} disabled={!sessions.length}>
            Xoá lịch sử
          </Button>
        </Popconfirm>
      </div>

      {selectedSession && (
        <div className="history-summary flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-panel px-3 py-2">
          <Tag color={selectedSession.ended ? 'default' : 'green'} bordered={false}>
            {selectedSession.ended ? 'Đã kết thúc' : 'Đang chơi'}
          </Tag>
          <span className="font-semibold">Phiên {selectedSession.sessionNo}</span>
          <span className="tabular-nums">{matchup(selectedSession)}</span>
          <span className="ml-auto tabular-nums text-muted">
            {formatDate(selectedSession.startMs)} {formatClock(selectedSession.startMs)} → {formatClock(selectedSession.endMs)}
          </span>
        </div>
      )}

      <Table<ScoreHistoryEntry>
        size="small"
        loading={loading}
        dataSource={entries}
        // Một thời điểm, một người chơi, một loại thay đổi: đủ để phân biệt mọi dòng.
        rowKey={(entry) => `${entry.timeMs}-${entry.playerId}-${entry.kind}`}
        pagination={{ pageSize: 15, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có thay đổi nào được ghi lại.' }}
        columns={[
          {
            title: 'Thời gian',
            width: 170,
            render: (_, entry) => (
              <span className="tabular-nums">
                {formatDate(entry.timeMs)} {formatClock(entry.timeMs)}
              </span>
            ),
          },
          {
            title: 'Phiên',
            width: 80,
            render: (_, entry) => (
              <Tooltip title="Chỉ xem phiên này">
                <a className="history-session-link tabular-nums" onClick={() => setSessionNo(entry.sessionNo)}>
                  #{entry.sessionNo}
                </a>
              </Tooltip>
            ),
          },
          { title: 'Người chơi', render: (_, entry) => <span className="font-semibold">{entry.playerName}</span> },
          { title: 'Thay đổi', render: (_, entry) => <ScoreChange entry={entry} /> },
          {
            title: 'Sửa từ',
            width: 130,
            render: (_, entry) =>
              entry.source === 'web' ? (
                <span className="flex items-center gap-1.5 text-muted">
                  <LuSmartphone /> Điện thoại
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted">
                  <LuMonitor /> Máy chủ
                </span>
              ),
          },
        ]}
      />
    </section>
  )
}
