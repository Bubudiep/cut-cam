import { Alert, Button, Checkbox, ColorPicker, Empty, Form, Input, Modal, Popconfirm, Select, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { useState, type ReactNode } from 'react'
import { LuLock, LuLockOpen, LuPencil, LuPlus, LuQrCode, LuRotateCcw, LuTrash2, LuVideo, LuVideoOff } from 'react-icons/lu'
import { CHANNEL_PATH } from '../../../shared/ipc'
import {
  CHANNEL_ID_RE,
  CHANNEL_QRS,
  DEFAULT_SCORE_COLOR_HIGH,
  DEFAULT_SCORE_COLOR_LOW,
  EXTERNAL_URL_RE,
  type Channel,
  type ChannelQr,
} from '../../../shared/types'

/** Kênh mới, chưa có người chơi: máy chủ tự tạo sẵn khi lưu. */
type NewChannel = Omit<Channel, 'players'>
import { useApp } from '../../context/AppContext'
import { useWebStatus } from '../../hooks/useWebStatus'

/** "Bàn số 1" -> "ban-so-1" */
function toChannelId(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** Các ô trong hộp sửa kênh. `visibleQrs` và `showQrs` là mặt ngược của `hiddenQrs` và `hideAllQrs`: bật = hiện. */
type FormValues = Pick<
  Channel,
  'id' | 'name' | 'cameraIds' | 'public' | 'password' | 'showVideo' | 'orderUrl' | 'billUrl' | 'scoreColorHigh' | 'scoreColorLow'
> & { visibleQrs: ChannelQr[]; showQrs: boolean }

const QR_LABELS: Record<ChannelQr, string> = {
  open: 'Mở bàn',
  control: 'Bảng điểm',
  order: 'Bill và Order',
  bill: 'Check bill',
  cut: 'Cắt camera',
}

const COLOR_PRESETS = [
  { label: 'Màu đèn hay dùng', colors: ['#ffffff', '#a3a3a3', '#ff3b30', '#ff9f0a', '#ffd60a', '#3dff7a', '#40c8ff', '#bf5af2'] },
]

const urlRule = { pattern: EXTERNAL_URL_RE, message: 'Đường dẫn phải bắt đầu bằng http:// hoặc https://' }

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="mb-2 mt-1 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{children}</div>
)

function ColorField({ name, label }: { name: 'scoreColorHigh' | 'scoreColorLow'; label: string }) {
  return (
    <Form.Item name={name} label={label} getValueFromEvent={(color: { toHexString(): string }) => color.toHexString()}>
      <ColorPicker showText disabledAlpha presets={COLOR_PRESETS} />
    </Form.Item>
  )
}

interface ModalProps {
  /** Kênh đang sửa; không có nghĩa là tạo kênh mới. */
  channel?: Channel
  /** Giá trị điền sẵn khi tạo kênh mới. */
  defaults?: NewChannel
  onClose(): void
  /** Đã lưu xong; `id` là mã kênh sau khi lưu (có thể vừa bị đổi). */
  onSaved?(id: string): void
}

/** Hộp thêm hoặc sửa một kênh. Dùng ở tab Channel và ở mục Điểm số (cài đặt nhanh). */
export function ChannelModal({ channel, defaults, onClose, onSaved }: ModalProps) {
  const { settings, update } = useApp()
  const [form] = Form.useForm<FormValues>()
  const source = channel ?? defaults
  if (!source) return null
  const initialValues: FormValues = {
    ...source,
    showQrs: !source.hideAllQrs,
    visibleQrs: CHANNEL_QRS.filter((qr) => !source.hiddenQrs.includes(qr)),
  }

  const save = async ({ visibleQrs, showQrs, ...values }: FormValues) => {
    const id = toChannelId(values.id)
    const patch = {
      ...values,
      id,
      hideAllQrs: !showQrs,
      hiddenQrs: CHANNEL_QRS.filter((qr) => !visibleQrs.includes(qr)),
    }
    const { channels } = settings
    const next = channel
      ? channels.map((c) => (c === channel ? { ...c, ...patch } : c))
      : // Kênh mới chưa có `players`: máy chủ tự tạo sẵn hai người chơi.
        [...channels, patch as Channel]
    await update({ channels: next })
    onSaved?.(id)
    onClose()
  }

  return (
    <Modal
      open
      width={640}
      title={channel ? `Sửa kênh ${channel.name}` : 'Thêm kênh'}
      okText="Lưu"
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={save}>
        <SectionTitle>Kênh</SectionTitle>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="name" label="Tên kênh" rules={[{ required: true, message: 'Nhập tên kênh' }]}>
            <Input placeholder="Bàn 1" autoFocus />
          </Form.Item>
          <Form.Item
            name="id"
            label="Mã kênh trong đường dẫn"
            tooltip="Chữ thường, số và gạch nối"
            rules={[
              {
                validator: async (_, value: string) => {
                  const id = toChannelId(value ?? '')
                  if (!CHANNEL_ID_RE.test(id)) throw new Error('Chỉ gồm chữ thường, số và gạch nối')
                  if (settings.channels.some((c) => c !== channel && c.id === id)) throw new Error('Đã có kênh khác dùng mã này')
                },
              },
            ]}
          >
            <Input addonBefore={CHANNEL_PATH} />
          </Form.Item>
          <Form.Item name="cameraIds" label="Camera của kênh này">
            <Select
              mode="multiple"
              placeholder="Chọn camera"
              options={settings.cameras.map((c) => ({ value: c.id, label: c.name }))}
              notFoundContent="Chưa có camera nào"
            />
          </Form.Item>
          <Form.Item
            name="showVideo"
            label="Chiếu hình camera"
            valuePropName="checked"
            tooltip="Tắt thì màn hình kênh là bảng điểm với các mã QR. Bật thì camera chiếu kín màn hình."
          >
            <Switch />
          </Form.Item>
        </div>

        <SectionTitle>Mã QR trên màn hình</SectionTitle>
        <div className="grid grid-cols-[auto_1fr] gap-x-6">
          <Form.Item
            name="showQrs"
            label="Hiện mã QR"
            valuePropName="checked"
            tooltip="Tắt thì màn hình kênh không hiện mã QR nào. Các lựa chọn từng mã bên cạnh vẫn được giữ để bật lại."
          >
            <Switch />
          </Form.Item>
          <Form.Item noStyle dependencies={['showQrs']}>
            {({ getFieldValue }) => (
              <Form.Item name="visibleQrs" label="Hiện từng mã" extra="Bỏ đánh dấu để ẩn riêng mã đó. Mã Mở bàn chỉ hiện khi bàn chưa có phiên nào đang chơi.">
                <Checkbox.Group
                  disabled={!getFieldValue('showQrs')}
                  options={CHANNEL_QRS.map((qr) => ({ value: qr, label: QR_LABELS[qr] }))}
                />
              </Form.Item>
            )}
          </Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="orderUrl" label="Đường dẫn Bill và Order" tooltip="Trang gọi món của bàn này. Để trống thì không hiện mã." rules={[urlRule]}>
            <Input placeholder="https://..." allowClear />
          </Form.Item>
          <Form.Item
            name="billUrl"
            label="Đường dẫn Check bill"
            tooltip="Trang kiểm tra hoá đơn của bàn này, ở máy chủ khác. Để trống thì không hiện mã."
            rules={[urlRule]}
          >
            <Input placeholder="https://..." allowClear />
          </Form.Item>
        </div>

        <SectionTitle>Màu bảng điểm</SectionTitle>
        <div className="grid grid-cols-2 gap-x-3">
          <ColorField name="scoreColorHigh" label="Điểm cao nhất" />
          <ColorField name="scoreColorLow" label="Các điểm còn lại" />
        </div>

        <SectionTitle>Mật khẩu</SectionTitle>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item
            name="public"
            label="Không cần mật khẩu"
            valuePropName="checked"
            tooltip="Bật thì bất kỳ ai trong mạng có đường dẫn đều mở được màn hình kênh, ghi điểm, xem camera của kênh này và tải video đã ghi. Camera ngoài kênh vẫn cần mật khẩu."
          >
            <Switch />
          </Form.Item>
          <Form.Item noStyle dependencies={['public']}>
            {({ getFieldValue }) =>
              !getFieldValue('public') && (
                <Form.Item
                  name="password"
                  label="Mật khẩu của kênh"
                  tooltip="Người nhập mật khẩu này chỉ vào được kênh này. Để trống thì kênh dùng mật khẩu chung ở tab Mạng LAN; mật khẩu chung lúc nào cũng vào được."
                >
                  <Input.Password placeholder="Để trống = dùng mật khẩu chung" autoComplete="new-password" />
                </Form.Item>
              )
            }
          </Form.Item>
        </div>
      </Form>
    </Modal>
  )
}

type Dialog = { kind: 'add' } | { kind: 'edit'; index: number } | null

/** Mỗi kênh là một đường dẫn riêng cho máy trạm: hiện camera được gán và bảng điểm. */
export function ChannelTab() {
  const { settings, update, updateChannel } = useApp()
  const web = useWebStatus()
  const [dialog, setDialog] = useState<Dialog>(null)
  const { channels } = settings
  const baseUrl = web?.urls[0] ?? 'http://<IP máy chủ>'
  const cameraName = (id: string) => settings.cameras.find((c) => c.id === id)?.name ?? id

  const newDefaults = (): NewChannel => {
    let n = channels.length + 1
    while (channels.some((c) => c.id === `channel-${n}`)) n++
    return {
      id: `channel-${n}`,
      name: `Kênh ${n}`,
      cameraIds: [],
      public: false,
      password: '',
      showVideo: false,
      orderUrl: '',
      billUrl: '',
      hideAllQrs: false,
      hiddenQrs: [],
      sessionNo: 1,
      sessionEnded: false,
      scoreColorHigh: DEFAULT_SCORE_COLOR_HIGH,
      scoreColorLow: DEFAULT_SCORE_COLOR_LOW,
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!settings.webEnabled && (
        <Alert
          type="warning"
          showIcon
          message="Chưa bật xem qua trình duyệt"
          description="Máy trạm chưa mở được đường dẫn kênh. Bật ở tab Mạng LAN."
        />
      )}
      <div>
        <Button type="primary" icon={<LuPlus />} onClick={() => setDialog({ kind: 'add' })}>
          Thêm kênh
        </Button>
      </div>

      <Table<Channel>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={channels}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Chưa có kênh nào. Tạo kênh để mỗi màn hình có một đường dẫn riêng với camera và bảng điểm."
            />
          ),
        }}
        columns={[
          { title: 'Tên', render: (_, channel) => <span className="font-semibold">{channel.name}</span> },
          {
            title: 'Đường dẫn cho máy trạm',
            render: (_, channel) => (
              <Typography.Text copyable code>
                {baseUrl + CHANNEL_PATH + channel.id}
              </Typography.Text>
            ),
          },
          {
            title: 'Camera',
            render: (_, channel) =>
              channel.cameraIds.length ? (
                channel.cameraIds.map((id) => <Tag key={id}>{cameraName(id)}</Tag>)
              ) : (
                <span className="text-muted">Chưa gán</span>
              ),
          },
          {
            title: 'Chiếu hình',
            width: 100,
            render: (_, channel) => (
              <Tooltip title={channel.showVideo ? 'Màn hình kênh hiện camera và bảng điểm' : 'Màn hình kênh chỉ hiện bảng điểm'}>
                <Switch
                  size="small"
                  checked={channel.showVideo}
                  checkedChildren={<LuVideo />}
                  unCheckedChildren={<LuVideoOff />}
                  onChange={(showVideo) => updateChannel(channel.id, (c) => ({ ...c, showVideo }))}
                />
              </Tooltip>
            ),
          },
          {
            title: 'Mã QR',
            width: 80,
            render: (_, channel) => (
              <Tooltip title={channel.hideAllQrs ? 'Màn hình kênh không hiện mã QR nào' : 'Màn hình kênh có hiện mã QR'}>
                <Switch
                  size="small"
                  checked={!channel.hideAllQrs}
                  checkedChildren={<LuQrCode />}
                  unCheckedChildren={<LuQrCode />}
                  onChange={(shown) => updateChannel(channel.id, (c) => ({ ...c, hideAllQrs: !shown }))}
                />
              </Tooltip>
            ),
          },
          {
            title: 'Mật khẩu',
            width: 110,
            render: (_, channel) => (
              <Tooltip
                title={
                  channel.public
                    ? 'Ai có đường dẫn cũng xem được'
                    : channel.password
                      ? 'Phải nhập mật khẩu riêng của kênh (hoặc mật khẩu chung)'
                      : 'Phải nhập mật khẩu chung'
                }
              >
                <Switch
                  size="small"
                  checked={!channel.public}
                  checkedChildren={<LuLock />}
                  unCheckedChildren={<LuLockOpen />}
                  onChange={(locked) => updateChannel(channel.id, (c) => ({ ...c, public: !locked }))}
                />
              </Tooltip>
            ),
          },
          {
            width: 110,
            align: 'right',
            render: (_, channel, index) => (
              <>
                <Popconfirm
                  title={`Kết thúc phiên ở ${channel.name} và đưa điểm mọi người về 0?`}
                  okText="Reset"
                  onConfirm={() => window.cutcam.scores.reset(channel.id)}
                >
                  <Tooltip title="Reset điểm">
                    <Button className="channel-reset" type="text" size="small" icon={<LuRotateCcw />} />
                  </Tooltip>
                </Popconfirm>
                <Tooltip title="Sửa">
                  <Button type="text" size="small" icon={<LuPencil />} onClick={() => setDialog({ kind: 'edit', index })} />
                </Tooltip>
                <Popconfirm
                  title={`Xoá kênh ${channel.name}?`}
                  description="Màn hình đang mở đường dẫn này sẽ không còn thấy camera."
                  okText="Xoá"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => update({ channels: channels.filter((c) => c !== channel) })}
                >
                  <Button type="text" size="small" danger icon={<LuTrash2 />} />
                </Popconfirm>
              </>
            ),
          },
        ]}
      />
      <p className="text-xs text-muted">
        Màn hình kênh mặc định hiện bảng điểm, bên phải là các mã QR: ghi điểm, bill và order, check bill, cắt camera. Bật "Chiếu
        hình" thì camera chiếu kín màn hình. Điểm số cũng sửa được ở mục Điểm số trên máy chủ.
      </p>

      {dialog?.kind === 'add' && <ChannelModal defaults={newDefaults()} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && channels[dialog.index] && (
        <ChannelModal channel={channels[dialog.index]} defaults={newDefaults()} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
