import { Alert, Button, Input, InputNumber, Switch, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { LuSave } from 'react-icons/lu'
import { useApp } from '../../context/AppContext'
import { useWebStatus } from '../../hooks/useWebStatus'
import { SettingRow } from './SettingRow'

/** Cho các máy khác trong mạng LAN mở CutCam bằng trình duyệt. */
export function WebTab() {
  const { settings, update } = useApp()
  const status = useWebStatus()
  const [port, setPort] = useState<number | null>(settings.webPort)
  const [password, setPassword] = useState(settings.webPassword)

  // Máy chủ tự sinh mật khẩu khi bật lần đầu: lấy giá trị đó về ô nhập.
  useEffect(() => setPassword(settings.webPassword), [settings.webPassword])
  useEffect(() => setPort(settings.webPort), [settings.webPort])

  const dirty = port !== settings.webPort || password !== settings.webPassword

  return (
    <div className="flex flex-col gap-3">
      <div>
        <SettingRow label="Cho phép máy khác xem qua trình duyệt" hint="Mở một trang web trong mạng LAN cho máy trạm và điện thoại.">
          <Switch checked={settings.webEnabled} onChange={(webEnabled) => update({ webEnabled })} />
        </SettingRow>
        <SettingRow label="Cổng" hint="Cổng 80 thì đường dẫn không cần ghi số cổng.">
          <InputNumber className="w-28" min={1} max={65535} value={port} onChange={setPort} />
        </SettingRow>
        <SettingRow label="Mật khẩu xem" hint="Bỏ trống để ứng dụng tự sinh. Đổi mật khẩu buộc mọi máy trạm đăng nhập lại.">
          <Input className="w-44" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </SettingRow>
      </div>
      <Button
        className="self-end"
        type="primary"
        icon={<LuSave />}
        disabled={!dirty}
        onClick={() => update({ webPort: port ?? settings.webPort, webPassword: password })}
      >
        Lưu cổng và mật khẩu
      </Button>

      {status?.error && <Alert type="error" showIcon message={status.error} />}
      {status?.running && (
        <Alert
          type="success"
          showIcon
          message="Đang chạy. Trên máy trạm, mở trình duyệt và vào:"
          description={
            status.urls.length === 0 ? (
              'Máy này chưa nối vào mạng nào.'
            ) : (
              <div className="flex flex-col">
                {status.urls.map((url) => (
                  <Typography.Text key={url} copyable code>
                    {url}
                  </Typography.Text>
                ))}
              </div>
            )
          }
        />
      )}
      <p className="text-xs text-muted">
        Máy trạm chỉ xem được, không thêm camera, không ghi hay xoá được. Lần đầu bật, Windows có thể hỏi quyền tường
        lửa: hãy cho phép mạng riêng. Kết nối không mã hoá, chỉ nên dùng trong mạng nội bộ.
      </p>
    </div>
  )
}
