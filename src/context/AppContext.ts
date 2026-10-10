import { createContext, useContext } from 'react'
import type { AddCameraInput, AddCameraResult, AppSettings, CameraConfig, Channel } from '../../shared/types'

export interface AppContextValue {
  settings: AppSettings
  update(patch: Partial<AppSettings>): Promise<void>
  addCamera(input: AddCameraInput): Promise<AddCameraResult>
  /** Thêm một camera giả lập phát hình thử. */
  addTestCamera(): Promise<AddCameraResult>
  updateCamera(id: string, patch: Partial<CameraConfig>): Promise<void>
  removeCamera(id: string): Promise<void>
  /** Sửa một kênh. Thay đổi hiện ngay trên giao diện rồi mới gửi đi, để bấm cộng điểm liên tiếp không bị mất lượt. */
  updateChannel(id: string, change: (channel: Channel) => Channel): Promise<void>
  chooseStorageDir(): Promise<void>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp phải được dùng bên trong <AppProvider>')
  return value
}
