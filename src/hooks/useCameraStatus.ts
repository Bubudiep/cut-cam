import { useSyncExternalStore } from 'react'
import type { CameraStatusMap } from '../../shared/types'
import { getStatusSnapshot, subscribeStatus } from '../services/cameraStatusStore'

/** Trạng thái ghi hình và xem trực tiếp của mọi camera đang bật. */
export function useCameraStatus(): CameraStatusMap {
  return useSyncExternalStore(subscribeStatus, getStatusSnapshot)
}
