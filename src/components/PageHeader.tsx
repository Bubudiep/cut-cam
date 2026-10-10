import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: ReactNode
  /** Các nút thao tác, nằm bên phải. */
  children?: ReactNode
}

export function PageHeader({ title, subtitle, children }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="page-subtitle text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}
