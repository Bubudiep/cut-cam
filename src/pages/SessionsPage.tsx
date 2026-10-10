import { Button, DatePicker, Empty, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LuRefreshCw, LuSearch } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import type { ScoreHistoryEntry, ScoreSession } from '../../shared/types'
import { PageHeader } from '../components/PageHeader'
import { ScoreChange } from '../components/ScoreHistory'
import { useApp } from '../context/AppContext'
import { ROUTES } from '../routes'
import { foldText, formatClock, formatDate, formatDuration } from '../utils/format'

const DAY_MS = 24 * 60 * 60 * 1000

/** Một phiên kèm kênh của nó, để gộp phiên của mọi kênh vào chung một bảng. */
interface Row extends ScoreSession {
  channelId: string
  channelName: string
}

const rowKey = (row: Row) => `${row.channelId}#${row.sessionNo}`

/** Người chơi và điểm của một phiên; người thắng (điểm cao nhất, không hoà) được tô đậm. */
function Players({ session }: { session: ScoreSession }) {
  const top = Math.max(...session.players.map((p) => p.score))
  const hasWinner = session.ended && session.players.some((p) => p.score !== top)
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {session.players.map((player) => {
        const won = hasWinner && player.score === top
        return (
          <span key={player.id} className={won ? 'font-semibold text-amber-400' : ''}>
            {player.name} <b className="tabular-nums">{player.score}</b>
          </span>
        )
      })}
    </span>
  )
}

/** Diễn biến của một phiên: từng lần đổi điểm theo thứ tự thời gian. Tải khi mở dòng. */
function SessionDetail({ row }: { row: Row }) {
  const [entries, setEntries] = useState<ScoreHistoryEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.cutcam.scores.history({ channelId: row.channelId, sessionNo: row.sessionNo, limit: 5000 }).then((list) => {
      // Lịch sử trả về mới nhất trước; diễn biến trận thì đọc từ đầu tới cuối.
      if (!cancelled) setEntries([...list].reverse())
    })
    return () => {
      cancelled = true
    }
    // `endMs` đổi khi phiên đang chơi có thêm điểm.
  }, [row.channelId, row.sessionNo, row.endMs])

  if (!entries) return <span className="text-muted">Đang tải…</span>
  return (
    <div className="session-detail flex max-h-72 flex-col gap-1 overflow-y-auto py-1 pr-2">
      {entries.map((entry) => (
        <div key={`${entry.timeMs}-${entry.playerId}-${entry.kind}`} className="flex items-center gap-3">
          <span className="w-16 shrink-0 tabular-nums text-muted">{formatClock(entry.timeMs)}</span>
          <span className="w-40 shrink-0 truncate font-semibold">{entry.playerName}</span>
          <ScoreChange entry={entry} />
        </div>
      ))}
    </div>
  )
}

/** Danh sách các phiên (trận) đã chơi ở mọi kênh: ai đấu với ai, tỉ số, lúc nào, bao lâu. */
export function SessionsPage() {
  const { settings } = useApp()
  const navigate = useNavigate()
  const { channels } = settings
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [channelId, setChannelId] = useState<string>()
  const [day, setDay] = useState<Dayjs | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const lists = await Promise.all(
        channels.map(async (channel) =>
          (await window.cutcam.scores.sessions(channel.id)).map((session) => ({
            ...session,
            channelId: channel.id,
            channelName: channel.name,
          })),
        ),
      )
      // Phiên của mọi kênh xếp chung, mới nhất trước.
      setRows(lists.flat().sort((a, b) => b.startMs - a.startMs))
    } finally {
      setLoading(false)
    }
  }, [channels])

  // Bảng điểm vừa đổi (ở máy chủ hoặc từ điện thoại) thì danh sách phiên cũng đổi theo.
  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const fromMs = day?.startOf('day').valueOf()
    const words = foldText(search).split(/\s+/).filter(Boolean)
    return rows.filter((row) => {
      if (channelId && row.channelId !== channelId) return false
      // Phiên kéo qua nửa đêm vẫn tính cho cả hai ngày.
      if (fromMs !== undefined && (row.endMs < fromMs || row.startMs >= fromMs + DAY_MS)) return false
      const text = foldText(
        `phien ${row.sessionNo} #${row.sessionNo} ${row.channelName} ${row.players.map((p) => p.name).join(' ')} ${formatDate(row.startMs)}`,
      )
      // Gõ nhiều từ thì phải khớp hết, vd. "an binh" ra các trận An gặp Bình.
      return words.every((word) => text.includes(word))
    })
  }, [rows, channelId, day, search])

  if (!channels.length) {
    return (
      <div className="grid h-full place-items-center">
        <Empty description="Chưa có kênh nào. Tạo kênh trong Cài đặt → Channel để có bảng điểm và lịch sử phiên.">
          <Button type="primary" onClick={() => navigate(ROUTES.settings)}>
            Mở cài đặt
          </Button>
        </Empty>
      </div>
    )
  }

  const playing = visible.filter((row) => !row.ended).length

  return (
    <div className="flex min-h-full flex-col gap-3 p-5">
      <PageHeader
        title="Lịch sử phiên"
        subtitle={`${visible.length} phiên${playing ? ` · ${playing} đang chơi` : ''}${visible.length !== rows.length ? ` (trên tổng ${rows.length})` : ''}`}
      >
        <Button icon={<LuRefreshCw />} onClick={() => void load()}>
          Làm mới
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="sessions-search w-72"
          allowClear
          prefix={<LuSearch className="text-muted" />}
          placeholder="Tìm theo tên người chơi, số phiên, kênh…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="sessions-channel w-44"
          allowClear
          placeholder="Mọi kênh"
          value={channelId}
          onChange={setChannelId}
          options={channels.map((c) => ({ value: c.id, label: c.name }))}
        />
        <DatePicker value={day} onChange={setDay} placeholder="Mọi ngày" format="DD/MM/YYYY" />
      </div>

      <Table<Row>
        className="sessions-table"
        size="small"
        loading={loading}
        dataSource={visible}
        rowKey={rowKey}
        pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{ emptyText: rows.length ? 'Không có phiên nào khớp.' : 'Chưa có phiên nào được ghi lại. Ghi điểm ở một kênh là phiên đầu tiên bắt đầu.' }}
        expandable={{ expandedRowRender: (row) => <SessionDetail row={row} />, expandRowByClick: true }}
        columns={[
          { title: 'Kênh', width: 140, render: (_, row) => row.channelName },
          { title: 'Phiên', width: 80, render: (_, row) => <span className="tabular-nums">#{row.sessionNo}</span> },
          { title: 'Người chơi và tỉ số', render: (_, row) => <Players session={row} /> },
          {
            title: 'Bắt đầu',
            width: 170,
            render: (_, row) => (
              <span className="tabular-nums">
                {formatDate(row.startMs)} {formatClock(row.startMs)}
              </span>
            ),
          },
          {
            title: 'Kết thúc',
            width: 110,
            render: (_, row) =>
              row.ended ? (
                <Tooltip title={formatDate(row.endMs)}>
                  <span className="tabular-nums">{formatClock(row.endMs)}</span>
                </Tooltip>
              ) : (
                <Tag color="green" bordered={false}>
                  Đang chơi
                </Tag>
              ),
          },
          {
            title: 'Thời lượng',
            width: 100,
            render: (_, row) => <span className="tabular-nums text-muted">{formatDuration(row.endMs - row.startMs)}</span>,
          },
        ]}
      />
    </div>
  )
}
