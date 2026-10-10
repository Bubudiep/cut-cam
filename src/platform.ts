import { createWebApi } from './services/webApi'

/**
 * Giao diện này chạy ở hai nơi: trong cửa sổ Electron trên máy chủ (preload đã gắn sẵn
 * `window.cutcam`), và trong trình duyệt của máy trạm (không có preload). Ở máy trạm, gắn
 * bản cài đặt gọi qua HTTP để phần còn lại của giao diện không cần biết mình đang ở đâu.
 */
export const isRemote = !('cutcam' in window)

if (isRemote) window.cutcam = createWebApi()
