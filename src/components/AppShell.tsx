import { Button, Menu, Tag } from 'antd'
import type { ReactNode } from 'react'
import { LuCctv, LuHistory, LuLogOut, LuScrollText, LuSettings, LuTrophy, LuVideo } from 'react-icons/lu'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCameraStatus } from '../hooks/useCameraStatus'
import { isRemote } from '../platform'
import { ROUTES } from '../routes'
import { logout } from '../services/webApi'
import { useRemoteSession } from './RemoteGate'

/** Các mục trên thanh bên; `key` là đường dẫn của trang. */
const ITEMS: { key: string; label: string; icon: ReactNode; hostOnly?: boolean }[] = [
  { key: ROUTES.live, label: 'Trực tiếp', icon: <LuVideo /> },
  { key: ROUTES.playback, label: 'Xem lại', icon: <LuHistory /> },
  { key: ROUTES.scores, label: 'Điểm số', icon: <LuTrophy />, hostOnly: true },
  { key: ROUTES.sessions, label: 'Lịch sử phiên', icon: <LuScrollText />, hostOnly: true },
  { key: ROUTES.settings, label: 'Cài đặt', icon: <LuSettings />, hostOnly: true },
]

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const status = useCameraStatus()
  const session = useRemoteSession()
  const recording = Object.values(status).filter((s) => s.recordingSince).length

  return (
    <div className="flex h-full">
      <nav className="flex w-44 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-4 text-base font-bold">
          <LuCctv className="text-accent" size={20} />
          CutCam
        </div>
        <Menu
          mode="inline"
          className="border-0! bg-transparent!"
          selectedKeys={[pathname]}
          onClick={({ key }) => navigate(key)}
          items={ITEMS.filter((item) => !(item.hostOnly && isRemote)).map(({ key, label, icon }) => ({ key, label, icon }))}
        />
        <div className="mt-auto flex flex-col items-start gap-2 p-3">
          {recording > 0 ? <Tag color="red">● Đang ghi {recording} camera</Tag> : <span className="text-muted">Không ghi hình</span>}
          {session === 'authenticated' && (
            <Button type="link" size="small" className="px-0!" icon={<LuLogOut />} onClick={() => void logout()}>
              Đăng xuất
            </Button>
          )}
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
