import { Alert, Button, Input, InputNumber, Progress, Select } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { LuFolderOpen, LuFolderSearch, LuRefreshCw } from 'react-icons/lu'
import { SEGMENT_MINUTES, type StorageInfo } from '../../../shared/types'
import { useApp } from '../../context/AppContext'
import { formatBytes } from '../../utils/format'
import { SettingRow } from './SettingRow'

export function StorageTab() {
  const { settings, update, chooseStorageDir } = useApp()
  const [info, setInfo] = useState<StorageInfo | null>(null)

  const refresh = useCallback(() => {
    void window.cutcam.storage.info().then(setInfo)
  }, [])
  useEffect(refresh, [refresh, settings.storageDir])

  const usedPercent = info?.totalBytes ? ((info.totalBytes - info.freeBytes) / info.totalBytes) * 100 : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input readOnly value={settings.storageDir} prefix={<LuFolderOpen className="text-muted" />} />
        <Button type="primary" icon={<LuFolderSearch />} onClick={chooseStorageDir}>
          Chọn thư mục
        </Button>
        <Button icon={<LuFolderOpen />} onClick={() => window.cutcam.storage.openDir()}>
          Mở
        </Button>
      </div>

      {info?.error ? (
        <Alert type="error" showIcon message={`Không dùng được thư mục này: ${info.error}`} />
      ) : (
        info && (
          <div>
            <Progress percent={Math.round(usedPercent)} showInfo={false} size="small" />
            <div className="flex items-center gap-2 text-xs text-muted">
              Còn trống {formatBytes(info.freeBytes)} / {formatBytes(info.totalBytes)} · Video CutCam chiếm{' '}
              {formatBytes(info.recordingsBytes)}
              <Button type="link" size="small" icon={<LuRefreshCw />} onClick={refresh} />
            </div>
          </div>
        )
      )}

      <div>
        <SettingRow label="Độ dài mỗi file" hint="Video được cắt thành các file nối tiếp nhau, đúng mốc giờ.">
          <Select
            className="w-28"
            value={settings.segmentMinutes}
            onChange={(segmentMinutes) => update({ segmentMinutes })}
            options={SEGMENT_MINUTES.map((m) => ({ value: m, label: `${m} phút` }))}
          />
        </SettingRow>
        <SettingRow label="Tự xoá video cũ" hint="Xoá video cũ hơn số ngày này. 0 = không bao giờ xoá.">
          <InputNumber
            className="w-28"
            min={0}
            max={3650}
            addonAfter="ngày"
            value={settings.retentionDays}
            onChange={(value) => update({ retentionDays: value ?? 0 })}
          />
        </SettingRow>
      </div>
      <p className="text-xs text-muted">
        Video lưu theo dạng tên-camera / năm-tháng-ngày / giờ-bắt-đầu__giờ-kết-thúc.mp4. Đổi thư mục không di chuyển
        video cũ.
      </p>
    </div>
  )
}
