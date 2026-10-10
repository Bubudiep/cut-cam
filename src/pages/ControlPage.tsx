import { Button, Empty, Input, Popconfirm } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { LuFlag, LuMinus, LuPlus, LuRotateCcw, LuSwords, LuTrash2, LuTrophy, LuUserPlus } from 'react-icons/lu'
import { applyScoreAction, MAX_PLAYERS, PLAYER_NAME_MAX, type ScoreAction } from '../../shared/scores'
import type { Player } from '../../shared/types'
import { useSearchParams } from 'react-router-dom'
import { NEW_SESSION_PARAM } from '../../shared/ipc'
import { NewSessionModal } from '../components/NewSessionModal'
import { useApp } from '../context/AppContext'
import { sendScoreAction } from '../services/webApi'

/** Sau khi vừa bấm, bỏ qua số liệu máy chủ gửi định kỳ trong chừng này: nó có thể được lấy từ trước lúc bấm. */
const SETTLE_MS = 2000

interface RowProps {
  player: Player
  leading: boolean
  /** Ván đã kết thúc: điểm đứng yên, chỉ còn đổi tên được. */
  locked: boolean
  onAction(action: ScoreAction): void
}

function PlayerRow({ player, leading, locked, onAction }: RowProps) {
  const [name, setName] = useState(player.name)
  useEffect(() => setName(player.name), [player.name])

  const commitName = () => {
    const next = name.trim()
    if (next && next !== player.name) onAction({ op: 'rename', playerId: player.id, name: next })
    else setName(player.name)
  }
  const adjust = (delta: number) => onAction({ op: 'adjust', playerId: player.id, delta })
  const stepButton = 'control-step flex! h-14! w-14! shrink-0 items-center! justify-center! p-0!'

  return (
    <div className="control-player flex flex-col gap-2 rounded-xl border border-line bg-panel p-3">
      <div className="flex items-center gap-1">
        <Input
          className="control-name"
          variant="borderless"
          value={name}
          maxLength={PLAYER_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onPressEnter={(e) => e.currentTarget.blur()}
          placeholder="Tên người chơi"
        />
        <Popconfirm
          title={`Đưa điểm của ${player.name} về 0?`}
          okText="Reset"
          disabled={locked || player.score === 0}
          onConfirm={() => onAction({ op: 'set', playerId: player.id, score: 0 })}
        >
          <Button className="control-reset-one" type="text" icon={<LuRotateCcw />} disabled={locked || player.score === 0} />
        </Popconfirm>
        <Popconfirm
          title={`Xoá ${player.name}?`}
          okText="Xoá"
          okButtonProps={{ danger: true }}
          onConfirm={() => onAction({ op: 'remove', playerId: player.id })}
        >
          <Button type="text" danger icon={<LuTrash2 />} disabled={locked} />
        </Popconfirm>
      </div>
      <div className="flex items-center gap-3">
        <Button className={stepButton} shape="circle" icon={<LuMinus size={24} />} disabled={locked} onClick={() => adjust(-1)} />
        <div className={`control-score flex-1 text-center text-6xl font-black leading-none tabular-nums ${leading ? 'text-amber-400' : ''}`}>
          {player.score}
        </div>
        <Button className={stepButton} type="primary" shape="circle" icon={<LuPlus size={24} />} disabled={locked} onClick={() => adjust(1)} />
      </div>
    </div>
  )
}

/**
 * Trang ghi điểm của một kênh, mở bằng điện thoại sau khi quét mã QR trên màn hình kênh: cộng trừ
 * điểm, đổi tên, thêm bớt người chơi. Màn hình kênh tự cập nhật theo sau một hai giây.
 */
export function ControlPage({ channelId }: { channelId: string }) {
  const { settings } = useApp()
  const remote = settings.channels[0]
  const [players, setPlayers] = useState<Player[]>(remote?.players ?? [])
  const [ended, setEnded] = useState(remote?.sessionEnded ?? false)
  const [error, setError] = useState('')
  // Vào từ mã QR "Mở bàn" thì hộp tạo ván mới mở sẵn.
  const [searchParams, setSearchParams] = useSearchParams()
  const [newSession, setNewSession] = useState(searchParams.has(NEW_SESSION_PARAM))
  const closeNewSession = () => {
    setNewSession(false)
    // Bỏ tham số khỏi đường dẫn, để tải lại trang không mở hộp lần nữa.
    if (searchParams.has(NEW_SESSION_PARAM)) setSearchParams({}, { replace: true })
  }
  const lastWrite = useRef(0)
  /** Chỉ câu trả lời của thao tác mới nhất mới được ghi đè lên màn hình. */
  const writeSeq = useRef(0)

  // Người khác (máy chủ, điện thoại khác) cũng sửa được bảng điểm: theo số liệu máy chủ khi mình không bấm.
  useEffect(() => {
    if (!remote || Date.now() - lastWrite.current <= SETTLE_MS) return
    setPlayers(remote.players)
    setEnded(remote.sessionEnded)
  }, [remote])

  if (!remote) {
    return (
      <div className="grid h-full place-items-center p-4">
        <Empty description={`Máy chủ chưa có kênh nào tên là "${channelId}". Hãy quét lại mã QR trên màn hình.`} />
      </div>
    )
  }

  const act = async (action: ScoreAction) => {
    const seq = ++writeSeq.current
    lastWrite.current = Date.now()
    setError('')
    // Hiện kết quả ngay cho bấm sướng tay; riêng thêm người thì chờ máy chủ cấp mã.
    if (action.op !== 'add') setPlayers((current) => applyScoreAction(current, action) ?? current)
    try {
      const channel = await sendScoreAction(action)
      if (seq !== writeSeq.current) return
      setPlayers(channel.players)
      setEnded(channel.sessionEnded)
    } catch (err) {
      if (seq !== writeSeq.current) return
      setError((err as Error).message)
      // Không ghi được: quay về số liệu máy chủ ở lần cập nhật tới.
      lastWrite.current = 0
    }
  }

  const top = Math.max(...players.map((p) => p.score))
  const isLeading = (player: Player) => player.score === top && players.some((p) => p.score !== top)

  return (
    <div className="control-page mx-auto flex h-full max-w-md flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <LuTrophy className="text-amber-400" size={18} />
        <span className="font-semibold">Ghi điểm</span>
        <span className="truncate text-muted">· {remote.name}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
        {players.map((player) => (
          <PlayerRow key={player.id} player={player} leading={isLeading(player)} locked={ended} onAction={act} />
        ))}
        {ended && (
          <div className="control-ended flex items-center justify-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-center text-muted">
            <LuFlag className="shrink-0 text-amber-400" /> Ván này đã kết thúc. Bấm "Ván mới" để chơi tiếp.
          </div>
        )}
        {players.length === 0 && <div className="py-8 text-center text-muted">Chưa có người chơi nào.</div>}
        {error && <div className="control-error text-center text-xs text-red-400">{error}</div>}
      </div>

      {newSession && (
        <NewSessionModal
          noun="Ván"
          currentNames={players.map((p) => p.name)}
          onCancel={closeNewSession}
          onStart={async (names) => {
            await act({ op: 'session', names })
            closeNewSession()
          }}
        />
      )}

      <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-line bg-panel px-3 py-2.5">
        <Button className="control-session" type="primary" size="large" icon={<LuSwords />} onClick={() => setNewSession(true)}>
          Ván mới
        </Button>
        <Popconfirm
          title="Kết thúc ván này?"
          description="Tỉ số được lưu lại, bảng điểm đứng yên tới khi bấm Ván mới."
          okText="Kết thúc"
          onConfirm={() => act({ op: 'end' })}
        >
          <Button className="control-end" size="large" icon={<LuFlag />} disabled={ended || players.every((p) => p.score === 0)}>
            Kết thúc ván
          </Button>
        </Popconfirm>
        <Button
          className="control-add"
          size="large"
          icon={<LuUserPlus />}
          disabled={ended || players.length >= MAX_PLAYERS}
          onClick={() => act({ op: 'add' })}
        >
          Thêm người chơi
        </Button>
        <Popconfirm title="Kết thúc ván này và đưa điểm mọi người về 0?" okText="Reset" onConfirm={() => act({ op: 'reset' })}>
          <Button className="control-reset" size="large" icon={<LuRotateCcw />} disabled={!players.length}>
            Reset điểm
          </Button>
        </Popconfirm>
      </footer>
    </div>
  )
}
