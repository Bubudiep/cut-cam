import { ipcRenderer, contextBridge } from 'electron'
import { IPC } from '../shared/ipc'
import type { CutCamApi } from '../shared/types'

function subscribe<Args extends unknown[]>(channel: string, listener: (...args: Args) => void) {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...(args as Args))
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

// --------- Expose some API to the Renderer process ---------
const api: CutCamApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    chooseStorageDir: () => ipcRenderer.invoke(IPC.settingsChooseStorageDir),
    onChanged: (listener) => subscribe(IPC.settingsChanged, listener),
  },
  storage: {
    info: () => ipcRenderer.invoke(IPC.storageInfo),
    openDir: () => ipcRenderer.invoke(IPC.storageOpenDir),
  },
  cameras: {
    discover: () => ipcRenderer.invoke(IPC.camDiscover),
    add: (input) => ipcRenderer.invoke(IPC.camAdd, input),
    addTest: () => ipcRenderer.invoke(IPC.camAddTest),
    test: (cameraId) => ipcRenderer.invoke(IPC.camTest, cameraId),
    status: () => ipcRenderer.invoke(IPC.camStatus),
    onStatus: (listener) => subscribe(IPC.camStatusChanged, listener),
    startRecording: (cameraId) => ipcRenderer.invoke(IPC.camStartRecording, cameraId),
    stopRecording: (cameraId) => ipcRenderer.invoke(IPC.camStopRecording, cameraId),
    startAll: () => ipcRenderer.invoke(IPC.camStartAll),
    stopAll: () => ipcRenderer.invoke(IPC.camStopAll),
    startPreview: (cameraId) => ipcRenderer.invoke(IPC.camStartPreview, cameraId),
    stopPreview: (cameraId) => ipcRenderer.invoke(IPC.camStopPreview, cameraId),
    onFrame: (listener) => subscribe(IPC.camFrame, listener),
  },
  web: {
    status: () => ipcRenderer.invoke(IPC.webStatus),
  },
  scores: {
    history: (query) => ipcRenderer.invoke(IPC.scoreHistory, query),
    sessions: (channelId) => ipcRenderer.invoke(IPC.scoreSessions, channelId),
    reset: (channelId) => ipcRenderer.invoke(IPC.scoreReset, channelId),
    end: (channelId) => ipcRenderer.invoke(IPC.scoreEnd, channelId),
    newSession: (channelId, names) => ipcRenderer.invoke(IPC.scoreNewSession, channelId, names),
    clearHistory: (channelId) => ipcRenderer.invoke(IPC.scoreClearHistory, channelId),
  },
  recordings: {
    list: (query) => ipcRenderer.invoke(IPC.recList, query),
    remove: (ids) => ipcRenderer.invoke(IPC.recRemove, ids),
    reveal: (id) => ipcRenderer.invoke(IPC.recReveal, id),
    exportTo: (ids) => ipcRenderer.invoke(IPC.recExport, ids),
  },
}

contextBridge.exposeInMainWorld('cutcam', api)
