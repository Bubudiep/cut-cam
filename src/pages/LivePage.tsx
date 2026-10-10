import { Button, Empty } from 'antd'
import { LuCircle, LuPlus, LuSquare } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'
import { CameraTile } from '../components/CameraTile'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import { useCameraStatus } from '../hooks/useCameraStatus'
import { isRemote } from '../platform'
import { ROUTES } from '../routes'

export function LivePage() {
  const navigate = useNavigate()
  const onOpenSettings = () => navigate(ROUTES.settings)
  const { settings } = useApp()
  const status = useCameraStatus()
  const cameras = settings.cameras.filter((c) => c.enabled)
  const recordingCount = cameras.filter((c) => status[c.id]?.recording).length

  const emptyText = isRemote
    ? 'Máy chủ chưa có camera nào đang bật.'
    : settings.cameras.length > 0
      ? 'Tất cả camera đang bị tắt. Bật lại trong phần Cài đặt.'
      : 'Vào Cài đặt để quét mạng LAN, thêm camera bằng IP hay MAC, hoặc thêm camera test.'

  return (
    <div className="flex min-h-full flex-col gap-4 p-5">
      <PageHeader title="Xem trực tiếp" subtitle={`${cameras.length} camera đang bật · ${recordingCount} đang ghi`}>
        {!isRemote && (
          <>
            <Button icon={<LuPlus />} onClick={onOpenSettings}>
              Thêm camera
            </Button>
            <Button
              type="primary"
              icon={<LuCircle />}
              onClick={() => window.cutcam.cameras.startAll()}
              disabled={!cameras.length}
            >
              Ghi tất cả
            </Button>
            <Button icon={<LuSquare />} onClick={() => window.cutcam.cameras.stopAll()} disabled={!recordingCount}>
              Dừng tất cả
            </Button>
          </>
        )}
      </PageHeader>

      {cameras.length === 0 ? (
        <div className="grid flex-1 place-items-center">
          <Empty description={emptyText}>
            {!isRemote && (
              <Button type="primary" onClick={onOpenSettings}>
                Mở cài đặt
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <div className={`grid gap-3 ${cameras.length === 1 ? 'max-w-4xl grid-cols-1' : 'grid-cols-2 2xl:grid-cols-3'}`}>
          {cameras.map((camera) => (
            <CameraTile key={camera.id} camera={camera} status={status[camera.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
