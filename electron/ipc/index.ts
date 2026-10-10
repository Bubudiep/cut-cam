import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { IPC } from '../../shared/ipc'
import { sessionNames } from '../../shared/scores'
import type { AddCameraInput, AppSettings, ListQuery, ScoreHistoryQuery } from '../../shared/types'
import { applyAutoLaunch } from '../services/autoLaunch'
import * as cameraAdmin from '../services/cameraAdmin'
import * as cameraService from '../services/cameraService'
import * as recordings from '../services/recordingStore'
import { clearScoreHistory, endSession, listScoreHistory, listScoreSessions, recordScoreChanges, startSession } from '../services/scoreHistory'
import { getSettings, updateSettings } from '../services/settingsStore'
import { applyWebServer, webServerStatus } from '../services/webServer'

const root = () => getSettings().storageDir

async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  }
  const win = BrowserWindow.getFocusedWindow()
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
}

/** Thư mục chứa giao diện đã build, để máy chủ web phát cho các máy trạm. */
let webDir = ''

async function applySettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const before = getSettings().channels
  const settings = updateSettings(patch)
  if (patch.channels) recordScoreChanges(before, settings.channels, 'host')
  if (patch.launchAtLogin !== undefined) applyAutoLaunch(settings.launchAtLogin)
  await cameraService.sync(settings)
  await applyWebServer(settings, webDir)
  return settings
}

export function registerIpc(rendererDir: string) {
  webDir = rendererDir
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) => applySettings(patch))
  ipcMain.handle(IPC.settingsChooseStorageDir, async () => {
    const dir = await pickDirectory('Chọn thư mục lưu video', root())
    return dir ? applySettings({ storageDir: dir }) : null
  })

  ipcMain.handle(IPC.storageInfo, () => recordings.storageInfo(root()))
  ipcMain.handle(IPC.storageOpenDir, async () => {
    fs.mkdirSync(root(), { recursive: true })
    await shell.openPath(root())
  })

  ipcMain.handle(IPC.camDiscover, () => cameraAdmin.discover())
  ipcMain.handle(IPC.camAdd, (_e, input: AddCameraInput) => cameraAdmin.addCamera(input))
  ipcMain.handle(IPC.camAddTest, () => cameraAdmin.addTestCamera())
  ipcMain.handle(IPC.camTest, (_e, id: string) => cameraAdmin.testCamera(id))
  ipcMain.handle(IPC.camStatus, () => cameraService.status())
  ipcMain.handle(IPC.camStartRecording, (_e, id: string) => cameraService.startRecording(id))
  ipcMain.handle(IPC.camStopRecording, (_e, id: string) => cameraService.stopRecording(id))
  ipcMain.handle(IPC.camStartAll, () => cameraService.startAll())
  ipcMain.handle(IPC.camStopAll, () => cameraService.stopAll())
  ipcMain.handle(IPC.camStartPreview, (_e, id: string) => cameraService.startPreview(id))
  ipcMain.handle(IPC.camStopPreview, (_e, id: string) => cameraService.stopPreview(id))

  ipcMain.handle(IPC.webStatus, () => webServerStatus())

  ipcMain.handle(IPC.scoreHistory, (_e, query: ScoreHistoryQuery) => listScoreHistory(query))
  ipcMain.handle(IPC.scoreSessions, (_e, channelId: string) => listScoreSessions(channelId))
  // Cài đặt đổi ở main process: báo cho cửa sổ app cập nhật theo.
  const broadcast = (settings: AppSettings | null) => {
    if (settings) BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(IPC.settingsChanged, settings))
  }
  ipcMain.handle(IPC.scoreReset, (_e, channelId: string) => broadcast(startSession(channelId, 'host')))
  ipcMain.handle(IPC.scoreEnd, (_e, channelId: string) => broadcast(endSession(channelId, 'host')))
  ipcMain.handle(IPC.scoreNewSession, (_e, channelId: string, names: unknown) => {
    const clean = sessionNames(names)
    if (clean) broadcast(startSession(channelId, 'host', clean))
  })
  ipcMain.handle(IPC.scoreClearHistory, (_e, channelId: string) => clearScoreHistory(channelId))

  ipcMain.handle(IPC.recList, (_e, query: ListQuery) => recordings.list(root(), query))
  ipcMain.handle(IPC.recRemove, (_e, ids: string[]) => recordings.remove(root(), ids))
  ipcMain.handle(IPC.recReveal, (_e, id: string) => {
    const file = recordings.resolveSegment(root(), id)
    if (file) shell.showItemInFolder(file)
  })
  ipcMain.handle(IPC.recExport, async (_e, ids: string[]) => {
    const dest = await pickDirectory('Chọn nơi lưu bản sao')
    return dest ? recordings.exportTo(root(), ids, dest) : null
  })
}
