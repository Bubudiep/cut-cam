import { StyleProvider } from '@ant-design/cssinjs'
import { App as AntApp, ConfigProvider } from 'antd'
import viVN from 'antd/locale/vi_VN'
import dayjs from 'dayjs'
import 'dayjs/locale/vi'
import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RemoteGate } from './components/RemoteGate'
import { AppProvider } from './context/AppProvider'
import { ChannelPage } from './pages/ChannelPage'
import { ControlPage } from './pages/ControlPage'
import { CutPage } from './pages/CutPage'
import { LivePage } from './pages/LivePage'
import { PlaybackPage } from './pages/PlaybackPage'
import { ScoresPage } from './pages/ScoresPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { isRemote } from './platform'
import { ROUTES } from './routes'
import { appTheme } from './theme'

dayjs.locale('vi')

/** Giao diện đầy đủ có thanh bên: dùng trên máy chủ, và cho máy trạm mở trang gốc (chỉ xem). */
function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

// Các trang của kênh lấy mã kênh và mã camera từ đường dẫn.
function ChannelRoute() {
  return <ChannelPage channelId={useParams().channelId ?? ''} />
}

function ControlRoute() {
  return <ControlPage channelId={useParams().channelId ?? ''} />
}

function CutRoute() {
  return <CutPage cameraId={useParams().cameraId ?? ''} />
}

/** Đường dẫn kênh; chấp nhận cả cách viết thiếu chữ n. Chỉ máy trạm mới mở các trang này. */
const CHANNEL_PREFIXES = ['channel', 'chanel']

function AppRoutes() {
  return (
    <Routes>
      <Route element={<ShellLayout />}>
        <Route path={ROUTES.live} element={<LivePage />} />
        <Route path={ROUTES.playback} element={<PlaybackPage />} />
        {/* Máy trạm chỉ được xem: không có trang điểm số, lịch sử phiên và cài đặt của máy chủ. */}
        {!isRemote && <Route path={ROUTES.scores} element={<ScoresPage />} />}
        {!isRemote && <Route path={ROUTES.sessions} element={<SessionsPage />} />}
        {!isRemote && <Route path={ROUTES.settings} element={<SettingsPage />} />}
      </Route>
      {isRemote &&
        CHANNEL_PREFIXES.map((prefix) => (
          <Route key={prefix} path={`/${prefix}/:channelId`}>
            <Route index element={<ChannelRoute />} />
            <Route path="control" element={<ControlRoute />} />
            <Route path="cut/:cameraId" element={<CutRoute />} />
          </Route>
        ))}
      <Route path="*" element={<Navigate to={ROUTES.live} replace />} />
    </Routes>
  )
}

function App() {
  // Cửa sổ app mở giao diện từ file trên đĩa (file://), ở đó chỉ định tuyến bằng phần sau dấu #
  // mới chạy được. Máy trạm mở qua máy chủ web nên dùng đường dẫn thật như /channel/<id>.
  const Router = isRemote ? BrowserRouter : HashRouter

  return (
    // `layer` đưa style của antd vào một lớp CSS riêng, xem thứ tự lớp trong styles/global.css.
    <StyleProvider layer>
      <ConfigProvider theme={appTheme} locale={viVN}>
        <AntApp className="h-full">
          <Router>
            {isRemote ? (
              <RemoteGate>
                <AppProvider>
                  <AppRoutes />
                </AppProvider>
              </RemoteGate>
            ) : (
              <AppProvider>
                <AppRoutes />
              </AppProvider>
            )}
          </Router>
        </AntApp>
      </ConfigProvider>
    </StyleProvider>
  )
}

export default App
