import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Tham số dòng lệnh báo app được hệ điều hành tự mở lúc đăng nhập: khởi động ẩn dưới khay. */
export const HIDDEN_FLAG = '--hidden'

export const startedHidden = () => process.argv.includes(HIDDEN_FLAG)

function linuxAutostartFile() {
  const configDir = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')
  return path.join(configDir, 'autostart', 'cutcam.desktop')
}

/** Linux không có API chung: môi trường desktop tự chạy mọi file .desktop trong ~/.config/autostart. */
function applyLinux(enabled: boolean) {
  const file = linuxAutostartFile()
  if (!enabled) {
    fs.rmSync(file, { force: true })
    return
  }
  // Bản AppImage chạy từ một thư mục tạm đổi sau mỗi lần mở: phải trỏ về chính file AppImage.
  const executable = process.env['APPIMAGE'] || process.execPath
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=CutCam',
    'Comment=Ghi hình camera IP',
    `Exec="${executable.replace(/(["\\`$])/g, '\\$1')}" ${HIDDEN_FLAG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, entry)
}

/**
 * Bật/tắt việc tự mở app khi người dùng đăng nhập vào máy.
 * Chỉ áp dụng cho bản đã đóng gói: ở chế độ phát triển, file thực thi là electron chung
 * chứ không phải CutCam, đăng ký nó thì lúc đăng nhập sẽ mở ra một cửa sổ Electron trống.
 */
export function applyAutoLaunch(enabled: boolean) {
  if (!app.isPackaged) return
  try {
    if (process.platform === 'linux') applyLinux(enabled)
    else app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] })
  } catch (err) {
    console.error('[autolaunch]', err)
  }
}
