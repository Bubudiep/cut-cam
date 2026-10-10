import { Tabs } from 'antd'
import type { ReactNode } from 'react'
import { LuAppWindow, LuCamera, LuHardDrive, LuNetwork, LuTv } from 'react-icons/lu'
import { PageHeader } from '../components/PageHeader'
import { CameraTab } from '../components/settings/CameraTab'
import { ChannelTab } from '../components/settings/ChannelTab'
import { GeneralTab } from '../components/settings/GeneralTab'
import { StorageTab } from '../components/settings/StorageTab'
import { WebTab } from '../components/settings/WebTab'

const tab = (key: string, label: string, icon: ReactNode, children: ReactNode) => ({
  key,
  icon,
  label,
  children: <div className="max-w-4xl pt-1">{children}</div>,
})

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-2 p-5">
      <PageHeader title="Cài đặt" />
      <Tabs
        items={[
          tab('storage', 'Lưu trữ', <LuHardDrive />, <StorageTab />),
          tab('camera', 'Camera', <LuCamera />, <CameraTab />),
          tab('channel', 'Channel', <LuTv />, <ChannelTab />),
          tab('web', 'Mạng LAN', <LuNetwork />, <WebTab />),
          tab('general', 'Ứng dụng', <LuAppWindow />, <GeneralTab />),
        ]}
      />
    </div>
  )
}
