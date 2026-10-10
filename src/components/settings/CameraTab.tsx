import { Alert, App, Button, Empty, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Switch, Table, Tag, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import { LuFlaskConical, LuPencil, LuPlugZap, LuPlus, LuRadar, LuTrash2 } from 'react-icons/lu'
import { DEFAULT_RTSP_PORT, type AddCameraInput, type CameraConfig, type CameraStatus, type DiscoveredDevice } from '../../../shared/types'
import { useApp } from '../../context/AppContext'
import { useCameraStatus } from '../../hooks/useCameraStatus'

// ---------------------------------------------------------------- thêm camera

interface AddModalProps {
  initial: Partial<AddCameraInput>
  onClose(): void
}

function AddCameraModal({ initial, onClose }: AddModalProps) {
  const { addCamera } = useApp()
  const { message } = App.useApp()
  const [form] = Form.useForm<AddCameraInput>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (values: AddCameraInput) => {
    setBusy(true)
    setError('')
    try {
      const result = await addCamera({ ...values, username: values.username ?? '', password: values.password ?? '' })
      if (!result.ok) return setError(result.error ?? 'Không thêm được camera.')
      message.success(`Đã thêm ${result.camera?.name} (${result.camera?.host})`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="Thêm camera"
      okText="Dò và thêm"
      confirmLoading={busy}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical" initialValues={{ username: 'admin', ...initial }} onFinish={submit}>
        <Form.Item
          name="target"
          label="Địa chỉ IP, địa chỉ MAC, hoặc URL rtsp://"
          rules={[{ required: true, message: 'Nhập địa chỉ camera' }]}
          extra="Thêm bằng MAC: ứng dụng tìm IP hiện tại của thiết bị, và tự tìm lại khi IP thay đổi."
        >
          <Input placeholder="192.168.1.64 · AA:BB:CC:DD:EE:FF · rtsp://user:pass@192.168.1.64/stream1" autoFocus />
        </Form.Item>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="username" label="Tên đăng nhập camera">
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu camera">
            <Input.Password autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="Tên hiển thị (tuỳ chọn)">
            <Input placeholder="Bàn 1" />
          </Form.Item>
          <Form.Item name="path" label="Đường dẫn luồng (trống = tự dò)">
            <Input placeholder="/Streaming/Channels/101" />
          </Form.Item>
        </div>
        {error && <Alert type="error" showIcon message={error} />}
      </Form>
    </Modal>
  )
}

// ---------------------------------------------------------------- quét mạng

function ScanModal({ onPick, onClose }: { onPick(device: DiscoveredDevice): void; onClose(): void }) {
  const [devices, setDevices] = useState<DiscoveredDevice[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.cutcam.cameras.discover().then((found) => !cancelled && setDevices(found))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Modal open title="Quét mạng LAN" footer={null} onCancel={onClose}>
      <List
        size="small"
        loading={devices === null}
        dataSource={devices ?? []}
        locale={{
          emptyText: devices && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Không thấy camera nào. Camera phải cùng mạng LAN và đã bật RTSP hoặc ONVIF; nếu không, hãy thêm bằng IP hoặc MAC."
            />
          ),
        }}
        renderItem={(device) => (
          <List.Item
            actions={[
              device.known ? (
                <Tag color="green">Đã thêm</Tag>
              ) : (
                <Button size="small" type="primary" onClick={() => onPick(device)}>
                  Chọn
                </Button>
              ),
            ]}
          >
            <List.Item.Meta
              title={
                <span className="tabular-nums">
                  {device.ip} <span className="text-muted">{device.mac || 'MAC không rõ'}</span>
                </span>
              }
              description={`${device.name || (device.onvif ? 'Camera ONVIF' : 'Thiết bị có RTSP')}${
                device.rtspPorts.length ? ` · cổng ${device.rtspPorts.join(', ')}` : ''
              }`}
            />
          </List.Item>
        )}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------- sửa camera

function EditCameraModal({ camera, onClose }: { camera: CameraConfig; onClose(): void }) {
  const { updateCamera } = useApp()
  const [form] = Form.useForm<CameraConfig>()
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const save = async () => {
    const values = await form.validateFields()
    await updateCamera(camera.id, values)
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      await save()
      const result = await window.cutcam.cameras.test(camera.id)
      setTest(
        result.ok
          ? { ok: true, text: `Kết nối được${result.codec ? ` · codec ${result.codec}` : ''}` }
          : { ok: false, text: result.error ?? 'Không kết nối được' },
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      open
      width={640}
      title={`Sửa ${camera.name}`}
      onCancel={onClose}
      footer={[
        !camera.test && (
          <Button key="test" icon={<LuPlugZap />} loading={testing} onClick={runTest}>
            Lưu và kiểm tra kết nối
          </Button>
        ),
        <Button key="cancel" onClick={onClose}>
          Huỷ
        </Button>,
        <Button key="save" type="primary" onClick={() => save().then(onClose)}>
          Lưu
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" initialValues={camera}>
        <Form.Item name="name" label="Tên hiển thị" rules={[{ required: true, message: 'Nhập tên camera' }]}>
          <Input />
        </Form.Item>
        {camera.test ? (
          <Alert type="info" showIcon message="Camera giả lập: phát hình thử do ứng dụng tự tạo, không kết nối thiết bị nào." />
        ) : (
          <div className="grid grid-cols-3 gap-x-3">
            <Form.Item name="host" label="Địa chỉ IP" rules={[{ required: true, message: 'Nhập địa chỉ' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="mac" label="Địa chỉ MAC" tooltip="Dùng để tìm lại camera khi IP thay đổi">
              <Input placeholder="AA:BB:CC:DD:EE:FF" />
            </Form.Item>
            <Form.Item name="rtspPort" label="Cổng RTSP">
              <InputNumber className="w-full" min={1} max={65535} placeholder={String(DEFAULT_RTSP_PORT)} />
            </Form.Item>
            <Form.Item name="username" label="Tên đăng nhập">
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="password" label="Mật khẩu">
              <Input.Password autoComplete="off" />
            </Form.Item>
            <Form.Item name="transport" label="Giao thức truyền">
              <Select
                options={[
                  { value: 'tcp', label: 'TCP (ổn định)' },
                  { value: 'udp', label: 'UDP' },
                ]}
              />
            </Form.Item>
            <Form.Item name="mainPath" label="Luồng chính (để ghi)" className="col-span-3">
              <Input />
            </Form.Item>
            <Form.Item name="subPath" label="Luồng phụ (để xem trực tiếp, trống = luồng chính)" className="col-span-3">
              <Input />
            </Form.Item>
            <Form.Item name="recordAudio" label="Ghi âm thanh" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        )}
        {test && <Alert type={test.ok ? 'success' : 'error'} showIcon message={test.text} />}
      </Form>
    </Modal>
  )
}

// ---------------------------------------------------------------- danh sách

function StatusTag({ camera, status }: { camera: CameraConfig; status?: CameraStatus }) {
  if (!camera.enabled) return <Tag>Tắt</Tag>
  if (status?.recorder === 'recording') return <Tag color="red">Đang ghi</Tag>
  if (status?.recorder === 'error') {
    return (
      <Tooltip title={status.recorderError}>
        <Tag color="orange">Lỗi ghi</Tag>
      </Tooltip>
    )
  }
  if (status?.preview === 'error') {
    return (
      <Tooltip title={status.previewError}>
        <Tag color="orange">Mất kết nối</Tag>
      </Tooltip>
    )
  }
  return <Tag color="green">Sẵn sàng</Tag>
}

type Dialog = { kind: 'add'; initial: Partial<AddCameraInput> } | { kind: 'scan' } | { kind: 'edit'; cameraId: string } | null

export function CameraTab() {
  const { settings, updateCamera, removeCamera, addTestCamera } = useApp()
  const { message } = App.useApp()
  const status = useCameraStatus()
  const [dialog, setDialog] = useState<Dialog>(null)
  const editing = dialog?.kind === 'edit' ? settings.cameras.find((c) => c.id === dialog.cameraId) : undefined

  const addTest = async () => {
    const result = await addTestCamera()
    if (result.ok) message.success(`Đã thêm ${result.camera?.name}. Mở trang Trực tiếp để xem hình thử.`)
    else message.error(result.error ?? 'Không thêm được camera test.')
  }

  const pickDevice = (device: DiscoveredDevice) => {
    const port = device.rtspPorts[0]
    const target = port && port !== DEFAULT_RTSP_PORT ? `${device.ip}:${port}` : device.ip
    setDialog({ kind: 'add', initial: { target, name: device.name || undefined } })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="primary" icon={<LuPlus />} onClick={() => setDialog({ kind: 'add', initial: {} })}>
          Thêm camera
        </Button>
        <Button icon={<LuRadar />} onClick={() => setDialog({ kind: 'scan' })}>
          Quét mạng LAN
        </Button>
        <Tooltip title="Camera giả lập phát hình thử, để thử ghi hình và stream khi chưa có camera thật">
          <Button icon={<LuFlaskConical />} onClick={addTest}>
            Thêm camera test
          </Button>
        </Tooltip>
      </div>

      <Table<CameraConfig>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={settings.cameras}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có camera nào" /> }}
        columns={[
          {
            title: 'Tên',
            render: (_, camera) => (
              <span className="font-semibold">
                {camera.name} {camera.test && <Tag className="ml-1">test</Tag>}
              </span>
            ),
          },
          {
            title: 'Địa chỉ',
            render: (_, camera) =>
              camera.test ? (
                <span className="text-muted">Hình thử tự tạo</span>
              ) : (
                <span className="tabular-nums">
                  {camera.host}
                  {camera.rtspPort !== DEFAULT_RTSP_PORT && `:${camera.rtspPort}`}
                  {camera.mac && <span className="ml-2 text-xs text-muted">{camera.mac}</span>}
                </span>
              ),
          },
          { title: 'Trạng thái', width: 110, render: (_, camera) => <StatusTag camera={camera} status={status[camera.id]} /> },
          {
            title: 'Bật',
            width: 60,
            render: (_, camera) => (
              <Switch size="small" checked={camera.enabled} onChange={(enabled) => updateCamera(camera.id, { enabled })} />
            ),
          },
          {
            width: 80,
            align: 'right',
            render: (_, camera) => (
              <>
                <Tooltip title="Sửa">
                  <Button type="text" size="small" icon={<LuPencil />} onClick={() => setDialog({ kind: 'edit', cameraId: camera.id })} />
                </Tooltip>
                <Popconfirm
                  title={`Gỡ camera ${camera.name}?`}
                  description="Video đã ghi vẫn nằm trong thư mục lưu trữ."
                  okText="Gỡ"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => removeCamera(camera.id)}
                >
                  <Button type="text" size="small" danger icon={<LuTrash2 />} />
                </Popconfirm>
              </>
            ),
          },
        ]}
      />
      <p className="text-xs text-muted">
        Lưu thay đổi về địa chỉ, tài khoản hoặc luồng sẽ kết nối lại camera và bắt đầu một file mới.
      </p>

      {dialog?.kind === 'add' && <AddCameraModal initial={dialog.initial} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'scan' && <ScanModal onPick={pickDevice} onClose={() => setDialog(null)} />}
      {editing && <EditCameraModal key={editing.id} camera={editing} onClose={() => setDialog(null)} />}
    </div>
  )
}
