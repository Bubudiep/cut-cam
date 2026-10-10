import type { CameraStatusMap } from '../../shared/types'

// Trạng thái camera do main process đẩy sang. Một lần đăng ký dùng chung cho mọi component.

let snapshot: CameraStatusMap = {}
let started = false
const listeners = new Set<() => void>()

function set(next: CameraStatusMap) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

export function subscribeStatus(listener: () => void) {
  if (!started) {
    started = true
    window.cutcam.cameras.onStatus(set)
    void window.cutcam.cameras.status().then(set)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getStatusSnapshot = () => snapshot
