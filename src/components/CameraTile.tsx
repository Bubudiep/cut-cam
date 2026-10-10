import { Button, Tag } from 'antd'
import { useRef } from 'react'
import { LuCircle, LuSquare } from 'react-icons/lu'
import type { CameraConfig, CameraStatus } from '../../shared/types'
import { useLivePreview } from '../hooks/useLivePreview'
import { useNow } from '../hooks/useNow'
import { isRemote } from '../platform'
import { formatDuration } from '../utils/format'

interface Props {
  camera: CameraConfig
  status?: CameraStatus
}

export function CameraTile({ camera, status }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const hasFrame = useLivePreview(camera.id, imgRef)
  const recording = status?.recording ?? false
  // Máy trạm chỉ hỏi trạng thái vài giây một lần: có khung hình tới là hiện luôn, khỏi chờ.
  const live = status?.preview === 'live' || (hasFrame && status?.preview === 'connecting')
  const now = useNow(!!status?.recordingSince)

  const toggle = () =>
    recording ? window.cutcam.cameras.stopRecording(camera.id) : window.cutcam.cameras.startRecording(camera.id)

  return (
    <div className={`tile overflow-hidden rounded-lg border bg-panel ${recording ? 'border-red-500' : 'border-line'}`}>
      <div className="relative aspect-video bg-black">
        <img ref={imgRef} alt="" className="h-full w-full object-contain" style={{ visibility: live ? 'visible' : 'hidden' }} />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center text-muted">
            <span>{status?.preview === 'error' ? status.previewError : 'Đang kết nối camera…'}</span>
            {status?.preview === 'error' && <small>Tự thử lại sau vài giây</small>}
          </div>
        )}
        {recording && (
          <Tag color="red" className="absolute! left-2 top-2 tabular-nums" title={status?.recorderError}>
            ●{' '}
            {status?.recordingSince
              ? `REC ${formatDuration(now - status.recordingSince)}`
              : status?.recorder === 'error'
                ? 'Lỗi ghi, đang thử lại'
                : 'Đang kết nối'}
          </Tag>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="tile__name truncate font-semibold">{camera.name}</div>
          <div className="truncate text-xs text-muted">{camera.test ? 'Camera test' : camera.host}</div>
        </div>
        {!isRemote && (
          <Button
            size="small"
            type={recording ? 'default' : 'primary'}
            danger={recording}
            icon={recording ? <LuSquare /> : <LuCircle />}
            onClick={toggle}
          >
            {recording ? 'Dừng ghi' : 'Ghi hình'}
          </Button>
        )}
      </div>
    </div>
  )
}
