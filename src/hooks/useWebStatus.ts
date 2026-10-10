import { useEffect, useState } from 'react'
import type { WebServerStatus } from '../../shared/types'
import { useApp } from '../context/AppContext'

/** Trạng thái máy chủ web cho máy trạm (đang chạy không, địa chỉ nào), cập nhật khi cài đặt liên quan đổi. */
export function useWebStatus(): WebServerStatus | null {
  const { settings } = useApp()
  const [status, setStatus] = useState<WebServerStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.cutcam.web.status().then((next) => !cancelled && setStatus(next))
    return () => {
      cancelled = true
    }
  }, [settings.webEnabled, settings.webPort, settings.webPassword])

  return status
}
