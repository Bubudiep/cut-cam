import { Alert, Button, Empty, Input, InputNumber, Popconfirm, Segmented, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import { LuFlag, LuMinus, LuPlus, LuRotateCcw, LuSettings, LuSwords, LuTrash2, LuUserPlus } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import { MAX_PLAYERS } from '../../shared/scores'
import type { Channel, Player } from '../../shared/types'
import { NewSessionModal } from '../components/NewSessionModal'
import { PageHeader } from '../components/PageHeader'
import { ScoreHistory } from '../components/ScoreHistory'
import { ChannelModal } from '../components/settings/ChannelTab'
import { useApp } from '../context/AppContext'
import { ROUTES } from '../routes'

interface PlayerCardProps {
  player: Player
  onChange(patch: Partial<Player>): void
  /** Cộng hoặc trừ điểm. Tách riêng khỏi `onChange` để bấm liên tiếp thật nhanh vẫn cộng đủ từng lượt. */
  onAdjust(delta: number): void
  onRemove(): void
  /** Phiên đã kết thúc: điểm đứng yên, chỉ còn đổi tên được. */
  locked: boolean
}

function PlayerCard({ player, onChange, onAdjust, onRemove, locked }: PlayerCardProps) {
  const [name, setName] = useState(player.name)
  useEffect(() => setName(player.name), [player.name])

  return (
    <div className="player-card flex w-56 flex-col items-center gap-3 rounded-lg border border-line bg-panel p-4">
      <div className="flex w-full gap-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== player.name && onChange({ name: name.trim() || player.name })}
          onPressEnter={(e) => e.currentTarget.blur()}
          placeholder="Tên người chơi"
        />
        <Tooltip title="Đưa điểm về 0">
          <Button className="player-reset" type="text" icon={<LuRotateCcw />} disabled={locked || player.score === 0} onClick={() => onChange({ score: 0 })} />
        </Tooltip>
        <Popconfirm title={`Xoá ${player.name}?`} okText="Xoá" okButtonProps={{ danger: true }} onConfirm={onRemove}>
          <Button type="text" danger icon={<LuTrash2 />} disabled={locked} />
        </Popconfirm>
      </div>
      <div className="player-score text-6xl font-bold tabular-nums">{player.score}</div>
      <div className="flex items-center gap-2">
        <Tooltip title="Trừ 1 điểm">
          <Button size="large" icon={<LuMinus />} disabled={locked} onClick={() => onAdjust(-1)} />
        </Tooltip>
        <InputNumber className="w-20" value={player.score} disabled={locked} onChange={(value) => onChange({ score: value ?? 0 })} />
        <Tooltip title="Cộng 1 điểm">
          <Button className="player-plus" size="large" type="primary" icon={<LuPlus />} disabled={locked} onClick={() => onAdjust(1)} />
        </Tooltip>
      </div>
    </div>
  )
}

/** Quản lý bảng điểm của từng kênh. Màn hình kênh ở máy trạm tự cập nhật theo sau một hai giây. */
export function ScoresPage() {
  const navigate = useNavigate()
  const { settings, updateChannel } = useApp()
  const [selectedId, setSelectedId] = useState(settings.channels[0]?.id ?? '')
  const [newSession, setNewSession] = useState(false)
  const [editing, setEditing] = useState(false)
  const channel = settings.channels.find((c) => c.id === selectedId) ?? settings.channels[0]

  if (!channel) {
    return (
      <div className="grid h-full place-items-center">
        <Empty description="Chưa có kênh nào. Tạo kênh trong Cài đặt → Channel để có bảng điểm.">
          <Button type="primary" onClick={() => navigate(ROUTES.settings)}>
            Mở cài đặt
          </Button>
        </Empty>
      </div>
    )
  }

  const ended = channel.sessionEnded
  const hasScores = channel.players.some((p) => p.score !== 0)

  const setPlayers = (change: (players: Player[]) => Player[]) =>
    updateChannel(channel.id, (c: Channel) => ({ ...c, players: change(c.players) }))

  const addPlayer = () =>
    setPlayers((players) => [
      ...players,
      { id: crypto.randomUUID().slice(0, 8), name: `Người chơi ${players.length + 1}`, score: 0 },
    ].slice(0, MAX_PLAYERS))

  return (
    <div className="flex min-h-full flex-col gap-4 p-5">
      <PageHeader title="Điểm số" subtitle={`Kênh ${channel.name} · phiên ${channel.sessionNo}${ended ? ' (đã kết thúc)' : ''} · ${channel.players.length} người chơi`}>
        <Tooltip title="Sửa nhanh kênh này: mã QR, màu bảng điểm, mật khẩu…">
          <Button className="channel-settings-button" icon={<LuSettings />} onClick={() => setEditing(true)}>
            Cài đặt kênh
          </Button>
        </Tooltip>
        <Button className="new-session-button" type="primary" icon={<LuSwords />} onClick={() => setNewSession(true)}>
          Phiên mới
        </Button>
        <Popconfirm
          title="Kết thúc phiên này?"
          description="Tỉ số được lưu vào lịch sử và bảng điểm đứng yên ở kết quả cuối, cho tới khi mở phiên mới."
          okText="Kết thúc"
          onConfirm={() => window.cutcam.scores.end(channel.id)}
        >
          <Button className="end-session-button" icon={<LuFlag />} disabled={ended || !hasScores}>
            Kết thúc phiên
          </Button>
        </Popconfirm>
        <Button icon={<LuUserPlus />} disabled={ended} onClick={addPlayer}>
          Thêm người chơi
        </Button>
        <Popconfirm
          title="Kết thúc phiên này và đưa điểm mọi người về 0?"
          description="Tỉ số hiện tại được lưu vào lịch sử, rồi mở phiên mới."
          okText="Reset"
          onConfirm={() => window.cutcam.scores.reset(channel.id)}
        >
          <Button icon={<LuRotateCcw />} disabled={!channel.players.length}>
            Reset điểm
          </Button>
        </Popconfirm>
      </PageHeader>

      {settings.channels.length > 1 && (
        <Segmented
          className="self-start"
          value={channel.id}
          onChange={(value) => setSelectedId(String(value))}
          options={settings.channels.map((c) => ({ value: c.id, label: c.name }))}
        />
      )}

      {ended && (
        <Alert
          className="session-ended"
          type="info"
          showIcon
          icon={<LuFlag />}
          message={`Phiên ${channel.sessionNo} đã kết thúc`}
          description="Bảng điểm đang đứng yên ở kết quả cuối. Mở phiên mới để ghi điểm tiếp."
          action={
            <Button type="primary" icon={<LuSwords />} onClick={() => setNewSession(true)}>
              Phiên mới
            </Button>
          }
        />
      )}

      {channel.players.length === 0 ? (
        <div className="grid place-items-center py-10">
          <Empty description="Kênh này chưa có người chơi nào.">
            <Button type="primary" icon={<LuUserPlus />} onClick={addPlayer}>
              Thêm người chơi
            </Button>
          </Empty>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {channel.players.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              onChange={(patch) => setPlayers((players) => players.map((p) => (p.id === player.id ? { ...p, ...patch } : p)))}
              onAdjust={(delta) =>
                setPlayers((players) => players.map((p) => (p.id === player.id ? { ...p, score: p.score + delta } : p)))
              }
              onRemove={() => setPlayers((players) => players.filter((p) => p.id !== player.id))}
              locked={ended}
            />
          ))}
        </div>
      )}

      {editing && <ChannelModal channel={channel} onClose={() => setEditing(false)} onSaved={setSelectedId} />}

      {newSession && (
        <NewSessionModal
          currentNames={channel.players.map((p) => p.name)}
          onCancel={() => setNewSession(false)}
          onStart={async (names) => {
            await window.cutcam.scores.newSession(channel.id, names)
            setNewSession(false)
          }}
        />
      )}

      {/* `key`: đổi kênh thì bỏ bộ lọc của kênh trước. */}
      <ScoreHistory key={channel.id} channel={channel} />
    </div>
  )
}
