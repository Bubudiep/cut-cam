import { Button, Input, Modal } from 'antd'
import { useState } from 'react'
import { LuMinus, LuPlus } from 'react-icons/lu'
import { DEFAULT_PLAYER_COUNT } from '../../shared/types'
import { MAX_PLAYERS, PLAYER_NAME_MAX } from '../../shared/scores'

interface Props {
  /** Cách gọi một trận ở nơi mở hộp này: máy chủ gọi là "Phiên", trang ghi điểm trên điện thoại gọi là "Ván". */
  noun?: 'Phiên' | 'Ván'
  /** Tên những người đang có trên bảng, để điền sẵn. */
  currentNames: string[]
  onCancel(): void
  /** Tên từng người chơi của phiên mới, theo thứ tự hiện trên bảng. */
  onStart(names: string[]): void | Promise<void>
}

const defaultName = (index: number) => `Người chơi ${index + 1}`

/**
 * Hộp mở phiên (trận) mới: chọn số người chơi và đặt tên từng người. Phiên đang chơi được chốt
 * điểm vào lịch sử, phiên mới bắt đầu với mọi người ở 0 điểm.
 */
export function NewSessionModal({ noun = 'Phiên', currentNames, onCancel, onStart }: Props) {
  const [names, setNames] = useState(() =>
    currentNames.length ? currentNames : Array.from({ length: DEFAULT_PLAYER_COUNT }, (_, i) => defaultName(i)),
  )
  const [busy, setBusy] = useState(false)

  const resize = (count: number) =>
    setNames((current) =>
      // Thêm chỗ thì lấy lại tên cũ ở vị trí đó nếu có, bớt thì cắt từ cuối.
      Array.from({ length: Math.min(MAX_PLAYERS, Math.max(1, count)) }, (_, i) => current[i] ?? currentNames[i] ?? defaultName(i)),
    )

  const start = async () => {
    setBusy(true)
    try {
      await onStart(names.map((name, i) => name.trim() || defaultName(i)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      centered
      width={380}
      title={`${noun} mới`}
      okText="Bắt đầu"
      confirmLoading={busy}
      onOk={start}
      onCancel={onCancel}
      className="new-session"
    >
      <p className="mb-3 mt-0 text-xs text-muted">
        Tỉ số đang có được lưu vào lịch sử. {noun} mới bắt đầu với mọi người ở 0 điểm.
      </p>
      <div className="mb-3 flex items-center gap-3">
        <span className="mr-auto font-semibold">Số người chơi</span>
        <Button className="session-fewer" icon={<LuMinus />} disabled={names.length <= 1} onClick={() => resize(names.length - 1)} />
        <span className="session-count w-6 text-center text-lg font-bold tabular-nums">{names.length}</span>
        <Button className="session-more" icon={<LuPlus />} disabled={names.length >= MAX_PLAYERS} onClick={() => resize(names.length + 1)} />
      </div>
      <div className="flex flex-col gap-2">
        {names.map((name, index) => (
          <Input
            key={index}
            className="session-name"
            size="large"
            addonBefore={index + 1}
            value={name}
            maxLength={PLAYER_NAME_MAX}
            placeholder={defaultName(index)}
            // Chạm vào là bôi đen cả tên, gõ luôn tên mới khỏi phải xoá.
            onFocus={(e) => e.target.select()}
            onChange={(e) => setNames((current) => current.map((n, i) => (i === index ? e.target.value : n)))}
            onPressEnter={start}
          />
        ))}
      </div>
    </Modal>
  )
}
