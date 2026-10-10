import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { applyAutoLaunch, startedHidden } from './services/autoLaunch'
import * as cameraService from './services/cameraService'
import { registerMediaProtocol, registerMediaScheme } from './services/mediaProtocol'
import * as recordings from './services/recordingStore'
import { getSettings } from './services/settingsStore'
import { applyWebServer, setDevServer, setSettingsListener, stopWebServer } from './services/webServer'
import { createTray, destroyTray, notifyHiddenOnce, updateTray } from './tray'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const RETENTION_INTERVAL_MS = 60 * 60 * 1000

const APP_NAME = 'CutCam'

// Khi chạy `npm run dev`, tên mặc định là "Electron" (hiện ở thanh tiêu đề lúc đang tải, trong menu, thông báo).
// Giữ nguyên thư mục dữ liệu cũ: đổi tên app mà không ghim lại sẽ làm mất settings.json đã lưu.
const userDataDir = app.getPath('userData')
app.setName(APP_NAME)
app.setPath('userData', userDataDir)

registerMediaScheme()

let win: BrowserWindow | null
let quitting = false

const recordingCount = () => Object.values(cameraService.status()).filter((s) => s.recording).length

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#0f1115',
    // Được hệ điều hành tự mở lúc đăng nhập: nằm sẵn dưới khay, không bật cửa sổ lên.
    show: !startedHidden(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Màn hình giám sát hay bị cửa sổ khác che: đừng để Chromium tự tạm dừng video khi đó.
      backgroundThrottling: false,
    },
  })

  // Đóng cửa sổ chỉ ẩn nó xuống khay hệ thống; việc ghi hình tiếp tục chạy ngầm.
  win.on('close', (event) => {
    if (quitting || !getSettings().minimizeToTray) return
    event.preventDefault()
    win?.hide()
    notifyHiddenOnce(recordingCount())
  })
  // Không ai xem thì dừng giải mã luồng xem trực tiếp, đỡ tốn CPU.
  win.on('hide', () => void cameraService.setPreviewsSuspended(true))
  win.on('show', () => void cameraService.setPreviewsSuspended(false))
  win.on('closed', () => {
    win = null
    void cameraService.stopAllPreviews()
  })
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) void cameraService.stopAllPreviews()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function showWindow() {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function runRetention() {
  const settings = getSettings()
  recordings
    .applyRetention(
      settings.storageDir,
      settings.cameras.map((c) => c.folder),
      settings.retentionDays,
    )
    .catch((err) => console.error('[retention]', err))
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', showWindow)

// Hoãn việc thoát cho tới khi ffmpeg đóng xong các file đang ghi.
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  Promise.all([cameraService.shutdown(), stopWebServer()]).finally(() => {
    destroyTray()
    app.quit()
  })
})

// Hai tiến trình cùng ghi vào một thư mục sẽ giẫm lên nhau.
if (!app.requestSingleInstanceLock()) {
  quitting = true
  app.quit()
} else {
  // Mở app lần nữa trong lúc nó đang chạy ngầm: hiện lại cửa sổ cũ.
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    cameraService.setEmitter((channel, ...args) => {
      if (channel === IPC.camStatusChanged) updateTray(recordingCount())
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
    })
    setSettingsListener((settings) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsChanged, settings)
    })
    registerMediaProtocol()
    registerIpc(RENDERER_DIST)
    createTray({
      showWindow,
      startAll: () => cameraService.startAll(),
      stopAll: () => void cameraService.stopAll(),
      quit: () => app.quit(),
    })
    await recordings.recoverOrphans(getSettings().storageDir).catch((err) => console.error('[recover]', err))
    runRetention()
    setInterval(runRetention, RETENTION_INTERVAL_MS)
    // Cài lại mỗi lần mở để đường dẫn đăng ký luôn đúng sau khi app được cập nhật hoặc chuyển chỗ.
    applyAutoLaunch(getSettings().launchAtLogin)
    // Cửa sổ ẩn từ đầu thì không có sự kiện 'hide' nào để tạm dừng xem trực tiếp.
    if (startedHidden()) await cameraService.setPreviewsSuspended(true)
    await cameraService.sync(getSettings())
    setDevServer(VITE_DEV_SERVER_URL)
    await applyWebServer(getSettings(), RENDERER_DIST)
    createWindow()
  })
}