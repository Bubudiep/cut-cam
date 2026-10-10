import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AddCameraInput, AppSettings, CameraConfig, Channel } from '../../shared/types'
import { AppContext, type AppContextValue } from './AppContext'

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)

  const apply = useCallback((next: AppSettings) => {
    settingsRef.current = next
    setSettings(next)
  }, [])

  /** Số thứ tự của lần ghi cài đặt gần nhất. */
  const writeSeq = useRef(0)

  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      const seq = ++writeSeq.current
      const saved = await window.cutcam.settings.update(patch)
      // Đã có lần ghi mới hơn đang chờ: bỏ qua kết quả cũ này, kẻo giao diện lùi về trạng thái
      // trước đó trong chốc lát và lượt bấm kế tiếp tính trên số liệu cũ.
      if (seq === writeSeq.current) apply(saved)
    },
    [apply],
  )

  const addCamera = useCallback(
    async (input: AddCameraInput) => {
      const result = await window.cutcam.cameras.add(input)
      if (result.settings) apply(result.settings)
      return result
    },
    [apply],
  )

  const addTestCamera = useCallback(async () => {
    const result = await window.cutcam.cameras.addTest()
    if (result.settings) apply(result.settings)
    return result
  }, [apply])

  const updateCamera = useCallback(
    (id: string, patch: Partial<CameraConfig>) => {
      const cameras = (settingsRef.current?.cameras ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c))
      return update({ cameras })
    },
    [update],
  )

  const removeCamera = useCallback(
    (id: string) => update({ cameras: (settingsRef.current?.cameras ?? []).filter((c) => c.id !== id) }),
    [update],
  )

  const updateChannel = useCallback(
    (id: string, change: (channel: Channel) => Channel) => {
      const current = settingsRef.current
      if (!current) return Promise.resolve()
      const channels = current.channels.map((c) => (c.id === id ? change(c) : c))
      apply({ ...current, channels })
      return update({ channels })
    },
    [apply, update],
  )

  const chooseStorageDir = useCallback(async () => {
    const next = await window.cutcam.settings.chooseStorageDir()
    if (next) apply(next)
  }, [apply])

  useEffect(() => {
    let cancelled = false
    void window.cutcam.settings.get().then((loaded) => {
      if (!cancelled) apply(loaded)
    })
    // Main process tự sửa cài đặt khi tìm lại được camera đã đổi IP.
    const unsubscribe = window.cutcam.settings.onChanged(apply)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [apply])

  const value = useMemo<AppContextValue | null>(
    () =>
      settings && {
        settings,
        update,
        addCamera,
        addTestCamera,
        updateCamera,
        removeCamera,
        updateChannel,
        chooseStorageDir,
      },
    [settings, update, addCamera, addTestCamera, updateCamera, removeCamera, updateChannel, chooseStorageDir],
  )

  if (!value) return <div className="grid h-full place-items-center text-muted">Đang tải…</div>
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
