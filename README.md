# CutCam

Ứng dụng desktop (Electron + Vite + React + TypeScript) để tìm camera IP trong mạng LAN, ghi hình liên tục xuống ổ đĩa và xem lại theo khoảng thời gian.

## Chạy

```bash
npm install        # tải kèm ffmpeg (gói ffmpeg-static)
npm run dev        # chạy ở chế độ phát triển
npm run build      # đóng gói bộ cài vào release/
npm run typecheck
npm run lint
```

## Tính năng

- **Thêm camera** – quét mạng LAN (ONVIF + cổng RTSP), hoặc nhập địa chỉ IP, địa chỉ MAC, hay URL `rtsp://`. Ứng dụng tự dò đường dẫn luồng của các hãng phổ biến. Có nút thêm **camera test** (hình thử tự tạo) để thử khi chưa có camera thật.
- **Trực tiếp / Xem lại** – xem nhiều camera, ghi từng camera hoặc tất cả; xem lại theo khoảng thời gian, tua, đổi tốc độ, chép ra thư mục, xoá.
- **Channel** – mỗi kênh là một đường dẫn `http://<IP máy chủ>/channel/<mã kênh>` cho một màn hình: hiện camera được gán và bảng điểm bên dưới. Kênh có thể đặt không cần mật khẩu.
- **Điểm số** – máy chủ quản lý người chơi và điểm của từng kênh (mặc định 2 người chơi); màn hình kênh tự cập nhật.
- **Cắt video** – mã QR ở góc mỗi camera trên màn hình kênh dẫn tới trang cắt video: chọn một khoảng để xem lại, kéo chọn đúng đoạn muốn lấy, rồi tải về bản gốc (H.265 nếu camera phát H.265) hoặc bản H.264 (`/channel/<kênh>/cut/<camera>`, tối đa 30 phút mỗi lần). Camera phải đang ghi thì mới có video để cắt.
- **Xem từ máy khác** – bật trong Cài đặt → Mạng LAN. Máy trạm chỉ xem, không đổi được gì.
- **Chạy ngầm / khởi động cùng máy** – đóng cửa sổ thì ẩn xuống khay và vẫn ghi; tuỳ chọn tự mở khi đăng nhập (Windows, Linux).
- **Cài đặt** chia tab: Lưu trữ, Camera, Channel, Mạng LAN, Ứng dụng.

Camera thêm bằng MAC (hoặc có MAC trong cài đặt) sẽ được tìm lại tự động khi router cấp cho nó IP khác.

Giao diện dùng Ant Design (component), Tailwind CSS (bố cục) và react-icons.

## Cách hoạt động

Mỗi camera có tối đa hai tiến trình ffmpeg do main process quản lý:

- **Ghi** – chép nguyên luồng chính (không mã hoá lại, rất nhẹ CPU) thành các file MP4 phân mảnh. Chạy độc lập với giao diện, tự kết nối lại khi mất mạng.
- **Xem trực tiếp** – giải mã luồng phụ thành các khung JPEG gửi sang giao diện. Chỉ chạy khi camera đang hiện trên trang Trực tiếp.

Mật khẩu camera được mã hoá bằng kho khoá của hệ điều hành trước khi ghi vào `settings.json`.

## Cấu trúc thư mục

```
electron/                 Main process (Node)
  main.ts                 Vòng đời app, cửa sổ
  tray.ts                 Biểu tượng và menu ở khay hệ thống
  preload.ts              API an toàn cho renderer: window.cutcam
  ipc/                    Đăng ký các kênh IPC
  services/
    settingsStore.ts      Đọc/ghi settings.json trong userData
    cameraService.ts      Chạy và giám sát các tiến trình ffmpeg (ghi + xem trực tiếp)
    cameraAdmin.ts        Quét, thêm và kiểm tra camera
    recordingStore.ts     Đặt tên file, liệt kê, xoá, dọn video cũ
    mediaProtocol.ts      Giao thức cutcam:// để phát video cho cửa sổ app
    webServer.ts          Máy chủ HTTP cho máy trạm: đăng nhập, xem trực tiếp, xem lại
    segmentFile.ts        Mở file video có hỗ trợ Range, dùng chung cho hai đường trên
    clipExport.ts         Cắt một khoảng thời gian thành một file MP4 để tải về
    autoLaunch.ts         Khởi động cùng máy
    ffmpeg.ts             Đường dẫn ffmpeg, tạo URL RTSP
    network/              scan (quét LAN, ONVIF), arp (IP ↔ MAC), rtspProbe (dò luồng)
shared/                   Kiểu dữ liệu và tên kênh IPC dùng chung
src/                      Renderer (React)
  pages/                  Live, Playback, Scores, Settings (máy chủ); Channel, Cut (máy trạm)
  components/             AppShell, CameraTile, Timeline, RemoteGate, settings/ (mỗi tab một file)
  context/                Cài đặt cho toàn app
  platform.ts             Nhận biết đang chạy trong app hay trên trình duyệt máy trạm
  services/               Nhận trạng thái camera và khung hình; webApi = bản gọi qua HTTP cho máy trạm
  hooks/  utils/  styles/
```

## Video lưu thế nào

```
<thư mục lưu trữ>/<camera>/<YYYY-MM-DD>/<HH-mm-ss>__<HH-mm-ss>.mp4
```

Tên file là giờ bắt đầu và giờ kết thúc, nên không cần cơ sở dữ liệu và có thể mở trực tiếp bằng VLC. File đang ghi có đuôi `.rec.mp4`; nếu app bị tắt đột ngột, lần mở sau sẽ tự đổi tên lại.
