import { Alert, Button, Card, Input, Spin } from 'antd'
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { LuCctv, LuLock } from 'react-icons/lu'
import { channelId, checkSession, login, onUnauthorized, type SessionState } from '../services/webApi'

type State = 'checking' | SessionState

const SessionContext = createContext<SessionState>('none')

/** `authenticated`: đã nhập mật khẩu. `public`: đang xem kênh không cần mật khẩu. */
// eslint-disable-next-line react-refresh/only-export-components
export const useRemoteSession = () => useContext(SessionContext)

/**
 * Chặn giao diện ở máy trạm cho tới khi đăng nhập bằng mật khẩu đặt trên máy chủ.
 * Kênh được máy chủ đặt là không cần mật khẩu thì vào thẳng.
 */
export function RemoteGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    checkSession()
      .then((session) => !cancelled && setState(session))
      .catch(() => !cancelled && setState('none'))
    // Hết phiên, hoặc máy chủ vừa đặt lại mật khẩu cho kênh.
    const unsubscribe = onUnauthorized(() => setState('none'))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const failure = await login(password)
    setBusy(false)
    setError(failure ?? '')
    if (!failure) {
      setPassword('')
      setState('authenticated')
    }
  }

  if (state === 'checking') {
    return (
      <div className="grid h-full place-items-center">
        <Spin tip="Đang kết nối máy chủ…" size="large">
          <div className="p-12" />
        </Spin>
      </div>
    )
  }
  if (state !== 'none') return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>

  return (
    <div className="grid h-full place-items-center p-4">
      <Card className="login w-full max-w-xs">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex items-center gap-2 text-lg font-bold">
            <LuCctv className="text-accent" /> CutCam
          </div>
          <p className="text-muted">
            {channelId
              ? `Kênh "${channelId}" cần mật khẩu. Hỏi người quản lý để lấy mật khẩu của kênh.`
              : 'Nhập mật khẩu xem camera do người quản lý máy chủ cung cấp.'}
          </p>
          <Input.Password
            size="large"
            prefix={<LuLock />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu"
            autoFocus
            required
          />
          <Button type="primary" size="large" htmlType="submit" loading={busy}>
            Đăng nhập
          </Button>
          {error && <Alert type="error" showIcon message={error} />}
        </form>
      </Card>
    </div>
  )
}
