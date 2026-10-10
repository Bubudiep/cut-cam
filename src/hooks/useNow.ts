import { useEffect, useState } from 'react'

/** Thời gian hiện tại, cập nhật mỗi `intervalMs` khi `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return now
}
