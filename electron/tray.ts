import { Menu, nativeImage, Tray } from 'electron'

interface TrayActions {
  showWindow(): void
  startAll(): void
  stopAll(): void
  quit(): void
}

const ICON_SIZE = 32
const BLUE = [0x3b, 0x82, 0xf6]
const RED = [0xef, 0x44, 0x44]
const WHITE = [0xff, 0xff, 0xff]

let tray: Tray | null = null
let actions: TrayActions | null = null
let recordingCount = -1
let balloonShown = false

/**
 * Vẽ biểu tượng khay bằng mã: hình máy quay màu xanh, thêm chấm đỏ khi đang ghi.
 * Tự vẽ để khỏi phải kèm file ảnh cho từng trạng thái (khay hệ thống của Windows không nhận SVG).
 */
export function drawIcon(recording: boolean) {
  const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4)
  const put = (x: number, y: number, [r, g, b]: number[]) => {
    // nativeImage nhận bitmap theo thứ tự BGRA.
    pixels.set([b, g, r, 0xff], (y * ICON_SIZE + x) * 4)
  }
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const body = x >= 2 && x <= 21 && y >= 8 && y <= 23
      // Ống kính: hình thang mở rộng dần về bên phải.
      const lens = x >= 22 && x <= 29 && Math.abs(y - 15.5) <= 2 + (x - 22) * 0.75
      if (body || lens) put(x, y, BLUE)
      if (recording) {
        const distance = Math.hypot(x - 11.5, y - 15.5)
        if (distance <= 5.5) put(x, y, WHITE)
        if (distance <= 4) put(x, y, RED)
      }
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: ICON_SIZE, height: ICON_SIZE })
}

export function createTray(trayActions: TrayActions) {
  actions = trayActions
  tray = new Tray(drawIcon(false))
  tray.on('click', () => actions?.showWindow())
  tray.on('double-click', () => actions?.showWindow())
  updateTray(0)
}

/** Cập nhật biểu tượng, chú thích và menu theo số camera đang ghi. */
export function updateTray(count: number) {
  if (!tray || !actions || count === recordingCount) return
  recordingCount = count
  tray.setImage(drawIcon(count > 0))
  tray.setToolTip(count > 0 ? `CutCam – đang ghi ${count} camera` : 'CutCam – không ghi hình')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở CutCam', click: actions.showWindow },
      { type: 'separator' },
      { label: count > 0 ? `Đang ghi ${count} camera` : 'Không ghi hình', enabled: false },
      { label: 'Ghi tất cả', click: actions.startAll },
      { label: 'Dừng tất cả', click: actions.stopAll, enabled: count > 0 },
      { type: 'separator' },
      { label: 'Thoát', click: actions.quit },
    ]),
  )
}

/** Lần đầu cửa sổ bị ẩn: nhắc người dùng là app vẫn đang chạy. Chỉ Windows có bong bóng thông báo. */
export function notifyHiddenOnce(count: number) {
  if (balloonShown || !tray || process.platform !== 'win32') return
  balloonShown = true
  tray.displayBalloon({
    title: 'CutCam vẫn đang chạy',
    content:
      count > 0
        ? `Đang ghi ${count} camera. Bấm biểu tượng ở khay hệ thống để mở lại, bấm chuột phải để thoát.`
        : 'Bấm biểu tượng ở khay hệ thống để mở lại, bấm chuột phải để thoát.',
  })
}

export function destroyTray() {
  tray?.destroy()
  tray = null
}
