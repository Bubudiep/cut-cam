import type { ReactNode } from 'react'

interface Props {
  label: string
  hint?: ReactNode
  children: ReactNode
}

/** Một dòng cài đặt: nhãn và chú thích bên trái, ô điều khiển bên phải. */
export function SettingRow({ label, hint, children }: Props) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
