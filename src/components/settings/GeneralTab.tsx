import { Input, Select, Switch } from 'antd'
import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { SettingRow } from './SettingRow'

export function GeneralTab() {
  const { settings, update } = useApp()
  const [shopName, setShopName] = useState(settings.shopName)
  useEffect(() => setShopName(settings.shopName), [settings.shopName])

  return (
    <div>
      <SettingRow label="Tên quán" hint="Hiện ở góc trên bên trái màn hình kênh khi một phiên vừa kết thúc. Để trống thì không hiện.">
        <Input
          className="shop-name w-64"
          value={shopName}
          maxLength={60}
          placeholder="Vd. Bida Hoàng Gia"
          onChange={(e) => setShopName(e.target.value)}
          onBlur={() => shopName.trim() !== settings.shopName && update({ shopName: shopName.trim() })}
          onPressEnter={(e) => e.currentTarget.blur()}
        />
      </SettingRow>
      <SettingRow label="Tự ghi hình khi mở ứng dụng" hint="Mọi camera đang bật bắt đầu ghi ngay khi CutCam khởi động.">
        <Switch checked={settings.autoRecordOnStart} onChange={(autoRecordOnStart) => update({ autoRecordOnStart })} />
      </SettingRow>
      <SettingRow
        label="Chất lượng hình xem trực tiếp"
        hint="Cao: nét và mượt, hợp với màn hình lớn, máy chủ tốn CPU hơn. Thường: nhẹ máy, hợp khi xem nhiều camera cùng lúc."
      >
        <Select
          className="w-40"
          value={settings.previewQuality}
          onChange={(previewQuality) => update({ previewQuality })}
          options={[
            { value: 'high', label: 'Cao (720p, 15 hình/giây)' },
            { value: 'standard', label: 'Thường (360p, 8 hình/giây)' },
          ]}
        />
      </SettingRow>
      <SettingRow
        label="Chạy ngầm khi đóng cửa sổ"
        hint="Đóng cửa sổ thì ứng dụng ẩn xuống khay hệ thống và tiếp tục ghi hình."
      >
        <Switch checked={settings.minimizeToTray} onChange={(minimizeToTray) => update({ minimizeToTray })} />
      </SettingRow>
      <SettingRow
        label="Khởi động cùng máy tính"
        hint="Tự mở ẩn dưới khay khi đăng nhập. Chỉ có hiệu lực ở bản đã cài đặt."
      >
        <Switch checked={settings.launchAtLogin} onChange={(launchAtLogin) => update({ launchAtLogin })} />
      </SettingRow>
    </div>
  )
}
