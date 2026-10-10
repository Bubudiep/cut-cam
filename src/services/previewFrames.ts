// Khung hình xem trực tiếp của mọi camera đi chung một kênh IPC; chia lại theo từng camera ở đây.

type FrameListener = (jpeg: Uint8Array) => void

const listeners = new Map<string, Set<FrameListener>>()
let started = false

export function subscribeFrames(cameraId: string, listener: FrameListener) {
  if (!started) {
    started = true
    window.cutcam.cameras.onFrame((id, jpeg) => listeners.get(id)?.forEach((l) => l(jpeg)))
  }
  const set = listeners.get(cameraId) ?? new Set()
  listeners.set(cameraId, set)
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}
