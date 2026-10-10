import { Empty, QRCode } from "antd";
import { useRef, type CSSProperties } from "react";
import {
  controlPagePath,
  cutPagePath,
  openTablePath,
} from "../../shared/ipc";
import type {
  CameraConfig,
  Channel,
  ChannelQr,
  Player,
} from "../../shared/types";
import { LedNumber, LedText } from "../components/LedNumber";
import { ledAspect } from "../components/ledGeometry";
import { useApp } from "../context/AppContext";
import { useCameraStatus } from "../hooks/useCameraStatus";
import { useLivePreview } from "../hooks/useLivePreview";

// Màn hình này chiếu lên tivi ở bàn bida, xem từ xa: mọi cỡ chữ tính theo bề rộng màn hình (vw)
// để tivi to nhỏ gì cũng cùng một tỉ lệ.
const NAME_STYLE: CSSProperties = { fontSize: "clamp(11px, 1.2vw, 30px)" };
const SCORE_STYLE: CSSProperties = { fontSize: "clamp(34px, 5.2vw, 130px)" };
const LABEL_STYLE: CSSProperties = { fontSize: "clamp(11px, 1.05vw, 26px)" };
const QR_SIZE = "clamp(72px, 7.5vw, 180px)";

/** Máy chủ có cho hiện mã QR này trên màn hình kênh không. */
const qrShown = (channel: Channel, qr: ChannelQr) =>
  !channel.hideAllQrs && !channel.hiddenQrs.includes(qr);

/** Mã QR trên nền trắng kèm một dòng chú thích. Người ở bàn quét bằng điện thoại. */
function QrCard({
  url,
  label,
  className,
  style,
}: {
  url: string;
  label: string;
  className: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`${className} flex flex-col items-center rounded-lg bg-white text-black shadow-lg`}
      style={{ padding: "0.4vw", width: `calc(${QR_SIZE} + 0.8vw)`, ...style }}
    >
      <QRCode
        value={url}
        type="svg"
        bordered={false}
        color="#000000"
        bgColor="#ffffff"
        style={{ width: QR_SIZE, height: QR_SIZE, padding: 0 }}
      />
      <span
        className="whitespace-nowrap font-semibold"
        style={{ fontSize: "clamp(9px, 0.8vw, 20px)" }}
      >
        {label}
      </span>
    </div>
  );
}

function ChannelCamera({
  camera,
  channelId,
  lost,
  showQr,
}: {
  camera: CameraConfig;
  channelId: string;
  lost: boolean;
  showQr: boolean;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const hasFrame = useLivePreview(camera.id, imgRef);
  // Điện thoại quét mã phải tới được máy chủ: dùng đúng địa chỉ mà màn hình này đang mở.
  const cutUrl = window.location.origin + cutPagePath(channelId, camera.id);

  return (
    <div className="channel-camera relative min-h-0 min-w-0 overflow-hidden bg-black">
      {/* `object-cover`: hình lấp kín khung, chấp nhận cắt bớt mép nếu tỉ lệ camera khác tỉ lệ màn hình. */}
      <img
        ref={imgRef}
        alt=""
        className="h-full w-full object-cover"
        style={{ visibility: hasFrame ? "visible" : "hidden" }}
      />
      {(!hasFrame || lost) && (
        <div
          className="absolute inset-0 grid place-items-center text-muted"
          style={{ fontSize: "clamp(14px, 1.8vw, 44px)" }}
        >
          {lost ? "Mất tín hiệu camera" : "Đang kết nối camera…"}
        </div>
      )}
      {showQr && (
        <QrCard
          url={cutUrl}
          label="Quét để tải video"
          className="channel-qr absolute"
          style={{ top: "1.6vw", right: "1.6vw" }}
        />
      )}
    </div>
  );
}

/** Ô của một người chơi trên bảng tỉ số: tên nhỏ ở trên, điểm lớn ở dưới. Người đang dẫn được tô vàng. */
function PlayerScore({
  player,
  leading,
}: {
  player: Player;
  leading: boolean;
}) {
  return (
    <div
      className="scoreboard-side flex min-w-0 flex-col overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/15"
      style={{ minWidth: "11vw", maxWidth: "22vw" }}
    >
      <div
        className="scoreboard-name truncate bg-black/75 text-center font-semibold uppercase tracking-wide text-white backdrop-blur"
        style={{ ...NAME_STYLE, padding: "0.3vw 1vw" }}
      >
        {player.name}
      </div>
      <div
        className={`scoreboard-score grid place-items-center font-black leading-none tabular-nums text-black ${
          leading ? "bg-amber-400" : "bg-white"
        }`}
        style={{ ...SCORE_STYLE, padding: "0.4vw 1.4vw" }}
      >
        {player.score}
      </div>
    </div>
  );
}

/** Bảng tỉ số kiểu truyền hình, nằm đè lên đáy video. */
function Scoreboard({ title, players }: { title: string; players: Player[] }) {
  if (players.length === 0) return null;
  const top = Math.max(...players.map((p) => p.score));
  // Hoà thì không ai được tô.
  const isLeading = (player: Player) =>
    player.score === top && players.some((p) => p.score !== top);

  return (
    <div
      className="scoreboard pointer-events-none absolute inset-x-0 flex flex-col items-center"
      style={{ bottom: "3vh", gap: "0.4vw" }}
    >
      <div
        className="rounded-md bg-emerald-600 font-bold uppercase tracking-widest text-white shadow-lg"
        style={{ ...LABEL_STYLE, padding: "0.2vw 1.4vw" }}
      >
        {title}
      </div>
      <div
        className="flex max-w-[96vw] items-stretch justify-center"
        style={{ gap: "0.7vw" }}
      >
        {players.map((player) => (
          <PlayerScore
            key={player.id}
            player={player}
            leading={isLeading(player)}
          />
        ))}
      </div>
    </div>
  );
}

// Bảng điểm kiểu bảng đèn LED trên nền đen. Màu đèn do máy chủ đặt cho từng kênh.
const SCREEN_PADDING = "2vw";
const CAPTION_STYLE: CSSProperties = {
  fontSize: "clamp(12px, 1.7vw, 42px)",
  lineHeight: 1.3,
  marginTop: "0.7vw",
};
/** Chú thích mã QR nhỏ hơn tên người chơi, cho vừa bề ngang của mã. */
const QR_CAPTION_STYLE: CSSProperties = {
  fontSize: "clamp(9px, 1.05vw, 26px)",
  lineHeight: 1.3,
  marginTop: "0.4vw",
};
const CAPTION_CLASS =
  "shrink-0 truncate text-center font-semibold uppercase tracking-wider text-white/85";

/** Một mã QR ở cột bên phải của bảng điểm: ô trắng vuông cạnh `size`, chú thích bên dưới. */
function SideQr({
  url,
  label,
  size,
  className,
}: {
  url: string;
  label: string;
  size: string;
  className: string;
}) {
  return (
    <div className={`${className} flex flex-col`} style={{ width: size }}>
      <div
        className="box-border bg-white"
        style={{
          width: size,
          height: size,
          padding: `calc(${size} * 0.07)`,
          borderRadius: "0.8vw",
        }}
      >
        <QRCode
          value={url}
          type="svg"
          bordered={false}
          color="#000000"
          bgColor="#ffffff"
          style={{
            width: "100%",
            height: "100%",
            padding: 0,
            display: "block",
          }}
        />
      </div>
      <div
        className="shrink-0 truncate text-center font-semibold uppercase text-white/85"
        // Mã càng nhỏ thì chữ cũng nhỏ theo, để chú thích dài nhất vẫn vừa bề ngang của mã.
        style={{
          ...QR_CAPTION_STYLE,
          fontSize: `min(${QR_CAPTION_STYLE.fontSize}, calc(${size} * 0.105))`,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// Bề ngang ước lượng của chữ thường trong tên kênh, tính theo chiều cao của đèn LED đứng cạnh nó:
// đủ rộng rãi để tên dài nhất cũng không tràn màn hình.
const NAME_FONT_RATIO = 1.2;
const NAME_LETTER_WIDTH = 0.95;
const NAME_SPACE_WIDTH = 0.4;
const NAME_GAP = 0.12;

/**
 * Tên kênh cỡ lớn cho màn hình chờ: phần chữ dùng chữ thường, riêng các con số hiện bằng đèn LED
 * 7 đoạn (vd. "BÀN" + đèn số 1). `sidePadding` là khoảng phải chừa mỗi bên, viết dạng biểu thức CSS.
 */
function IdleName({
  name,
  color,
  sidePadding,
}: {
  name: string;
  color: string;
  sidePadding: string;
}) {
  // Tách tên thành các đoạn chữ và đoạn số xen kẽ: "Bàn VIP 12" -> ["Bàn VIP ", "12"].
  const parts = name.split(/(\d+)/).filter(Boolean);
  const isNumber = (part: string) => /^\d+$/.test(part);
  // Tổng bề ngang của cả tên, tính theo số lần chiều cao đèn; từ đó chọn chiều cao lớn nhất còn vừa.
  const units = parts.reduce(
    (sum, part) =>
      sum +
      NAME_GAP +
      (isNumber(part)
        ? ledAspect(part.length)
        : [...part].reduce(
            (width, char) =>
              width + (char === " " ? NAME_SPACE_WIDTH : NAME_LETTER_WIDTH),
            0,
          )),
    0,
  );
  const height = `min(38vh, calc((100vw - 2 * ${sidePadding}) / ${units.toFixed(2)}))`;

  return (
    <div
      className="idle-name flex items-center justify-center whitespace-pre"
      style={{ gap: `calc(${height} * ${NAME_GAP})` }}
    >
      {parts.map((part, index) =>
        isNumber(part) ? (
          <LedText
            key={index}
            text={part}
            color={color}
            glow="0.5vw"
            className="idle-number block shrink-0"
            style={{
              height,
              width: `calc(${height} * ${ledAspect(part.length).toFixed(3)})`,
            }}
          />
        ) : (
          <span
            key={index}
            className="idle-word font-medium leading-none"
            style={{
              color,
              fontSize: `calc(${height} * ${NAME_FONT_RATIO})`,
              textShadow: `0 0 1vw ${color}66`,
              transform: "translateY(-5%)",
            }}
          >
            {part.trim()}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Bảng điểm chiếm trọn màn hình, cho kênh không chiếu hình camera: bên trái là các ô điểm kiểu
 * đồng hồ LED (tên bên dưới), bên phải là cột mã QR. Mép trên, mép dưới của hai bên thẳng hàng nhau.
 */
function FullScoreboard({
  channel,
  shopName,
  controlUrl,
  cutLinks,
}: {
  channel: Channel;
  shopName: string;
  controlUrl: string;
  cutLinks: { id: string; url: string; label: string }[];
}) {
  const { players } = channel;
  const top = Math.max(...players.map((p) => p.score));
  const shown = (qr: ChannelQr) => qrShown(channel, qr);
  // Hai người thì một hàng; ba, bốn người thì 2 x 2; đông hơn nữa thì thêm cột.
  const columns =
    players.length <= 4
      ? Math.min(players.length, 2)
      : Math.ceil(players.length / 2);
  const rows = Math.ceil(players.length / Math.max(columns, 1));
  // Mọi ô dùng chung số chữ số, để các con số to bằng nhau và thẳng cột.
  const cells = Math.max(2, ...players.map((p) => String(p.score).length));

  // Mã nào máy chủ cho ẩn, hoặc chưa có đường dẫn, thì không hiện.
  const qrs = [
    // Bàn đang trống (phiên trước đã kết thúc): mời khách quét để nhập tên và bắt đầu chơi.
    ...(shown("open") && channel.sessionEnded
      ? [
          {
            id: "open",
            url: window.location.origin + openTablePath(channel.id),
            label: "Mở bàn",
            className: "open-qr",
          },
        ]
      : []),
    ...(shown("control")
      ? [
          {
            id: "control",
            url: controlUrl,
            label: "Bảng điểm",
            className: "control-qr",
          },
        ]
      : []),
    ...(shown("order") && channel.orderUrl
      ? [
          {
            id: "order",
            url: channel.orderUrl,
            label: "Bill và Order",
            className: "order-qr",
          },
        ]
      : []),
    ...(shown("bill") && channel.billUrl
      ? [
          {
            id: "bill",
            url: channel.billUrl,
            label: "Check bill",
            className: "bill-qr",
          },
        ]
      : []),
    ...(shown("cut")
      ? cutLinks.map((link) => ({ ...link, className: "channel-qr" }))
      : []),
  ];
  // Các mã to bằng nhau, vừa khít chiều cao màn hình dù có mấy mã.
  const qrSize = `min(9vw, ${(60 / Math.max(qrs.length, 1)).toFixed(1)}vh)`;

  return (
    <div
      className="score-screen relative flex h-full"
      style={{
        padding: SCREEN_PADDING,
        gap: SCREEN_PADDING,
        background: "#07080a",
      }}
    >
      {channel.sessionEnded ? (
        // Phiên vừa kết thúc: bảng điểm nhường chỗ cho tên kênh, tới khi có phiên mới. Tên nằm đúng
        // giữa màn hình, nên chừa hai bên một khoảng bằng cột mã QR để không đè lên nó.
        <div className="min-w-0 flex-1">
          <div className="score-idle absolute inset-0 grid place-items-center">
            <IdleName
              name={channel.name}
              color={channel.scoreColorHigh}
              sidePadding={
                qrs.length
                  ? `(${qrSize} + ${SCREEN_PADDING} * 2)`
                  : SCREEN_PADDING
              }
            />
          </div>
        </div>
      ) : players.length === 0 ? (
        <div
          className="grid min-w-0 flex-1 place-items-center text-muted"
          style={{ fontSize: "clamp(14px, 1.8vw, 44px)" }}
        >
          Chưa có người chơi. Quét mã Bảng điểm để thêm.
        </div>
      ) : (
        <div
          className="grid min-h-0 min-w-0 flex-1"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            columnGap: SCREEN_PADDING,
            rowGap: "1.2vw",
          }}
        >
          {players.map((player) => {
            // Điểm cao nhất sáng màu chính; các điểm còn lại dùng màu nhạt hơn.
            const color =
              player.score === top
                ? channel.scoreColorHigh
                : channel.scoreColorLow;
            return (
              <div
                key={player.id}
                className="score-side flex min-h-0 min-w-0 flex-col"
              >
                <div
                  className="score-value box-border min-h-0 flex-1 bg-black"
                  data-score={player.score}
                  data-color={color}
                  style={{
                    padding: "6%",
                    borderRadius: "1.2vw",
                    border: `0.15vw solid ${color}55`,
                    boxShadow: `inset 0 0 3vw ${color}1f`,
                  }}
                >
                  <LedNumber
                    value={player.score}
                    cells={cells}
                    color={color}
                    className="block h-full w-full"
                    glow="0.5vw"
                  />
                </div>
                <div
                  className={`score-name ${CAPTION_CLASS}`}
                  style={CAPTION_STYLE}
                >
                  {player.name}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {channel.sessionEnded && shopName && (
        <div
          className="shop-name absolute max-w-[60vw] truncate font-semibold uppercase tracking-wider text-white/85"
          style={{
            top: SCREEN_PADDING,
            left: SCREEN_PADDING,
            fontSize: "clamp(14px, 2.4vw, 60px)",
            lineHeight: 1.2,
          }}
        >
          {shopName}
        </div>
      )}
      {qrs.length > 0 && (
        <div className="score-qrs flex shrink-0 flex-col justify-between">
          {qrs.map((qr) => (
            <SideQr
              key={qr.id}
              url={qr.url}
              label={qr.label}
              size={qrSize}
              className={qr.className}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Màn hình của một kênh ở máy trạm. Mặc định là bảng điểm với cột mã QR; kênh được bật chiếu hình thì video
 * kín màn hình và bảng tỉ số nằm đè phía dưới.
 */
export function ChannelPage({ channelId }: { channelId: string }) {
  const { settings } = useApp();
  const status = useCameraStatus();
  const channel = settings.channels[0];
  const cameras = settings.cameras.filter((c) => c.enabled);

  if (!channel) {
    return (
      <div className="grid h-full place-items-center">
        <Empty
          description={`Máy chủ chưa có kênh nào tên là "${channelId}". Kiểm tra lại đường dẫn.`}
        />
      </div>
    );
  }

  const controlUrl = window.location.origin + controlPagePath(channel.id);
  if (!channel.showVideo) {
    return (
      <FullScoreboard
        channel={channel}
        shopName={settings.shopName}
        controlUrl={controlUrl}
        cutLinks={cameras.map((camera) => ({
          id: camera.id,
          url: window.location.origin + cutPagePath(channel.id, camera.id),
          label: cameras.length > 1 ? `Cắt ${camera.name}` : "Cắt camera",
        }))}
      />
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-black">
      {cameras.length === 0 ? (
        <div className="grid h-full place-items-center">
          <Empty description="Kênh này chưa được gán camera nào đang bật." />
        </div>
      ) : (
        <div
          className="grid h-full gap-0.5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(cameras.length, 2)}, minmax(0, 1fr))`,
          }}
        >
          {cameras.map((camera) => (
            <ChannelCamera
              key={camera.id}
              camera={camera}
              channelId={channel.id}
              lost={status[camera.id]?.preview === "error"}
              showQr={qrShown(channel, "cut")}
            />
          ))}
        </div>
      )}
      {qrShown(channel, "control") && (
        <QrCard
          url={controlUrl}
          label="Quét để ghi điểm"
          className="control-qr absolute"
          style={{ top: "1.6vw", left: "1.6vw" }}
        />
      )}
      <Scoreboard title={channel.name} players={channel.players} />
    </div>
  );
}
