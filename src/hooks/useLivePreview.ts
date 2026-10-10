import { useEffect, useState, type RefObject } from 'react'
import { subscribeFrames } from '../services/previewFrames'

/**
 * Đưa hình trực tiếp của một camera vào thẻ <img>. Chỉ khi có component gọi hook này thì
 * máy chủ mới giải mã luồng của camera đó. Trả về true khi đã có ít nhất một khung hình.
 */
export function useLivePreview(cameraId: string, imgRef: RefObject<HTMLImageElement>): boolean {
  const [hasFrame, setHasFrame] = useState(false)

  useEffect(() => {
    const api = window.cutcam.cameras
    void api.startPreview(cameraId)
    const unsubscribe = subscribeFrames(cameraId, (jpeg) => {
      const img = imgRef.current
      if (!img) return
      const previous = img.src
      img.src = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }))
      if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
      setHasFrame(true)
    })
    return () => {
      unsubscribe()
      setHasFrame(false)
      void api.stopPreview(cameraId)
    }
  }, [cameraId, imgRef])

  return hasFrame
}
