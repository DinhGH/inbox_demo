# Unified Realtime Inbox Demo (Messenger & Telegram)

Dự án Proof of Concept kết nối đa kênh tin nhắn thời gian thực giữa **Facebook Messenger** (Meta Platform API) và **Telegram Bot** vào một giao diện web duy nhất bằng **Node.js, Express, Socket.IO và Vanilla JS**.

---

## Kiến trúc hệ thống (Architecture)

```text
┌─────────────────┐       ┌──────────────────┐
│  Facebook User  │       │  Telegram User   │
└────────┬────────┘       └────────┬─────────┘
         │ sends message           │ sends message
         ▼                         ▼
┌─────────────────┐       ┌──────────────────┐
│ Meta Messenger  │       │   Telegram Bot   │
└────────┬────────┘       └────────┬─────────┘
         │ HMAC SHA256             │ X-Telegram-Bot-Api-Secret-Token
         ▼                         ▼
   POST /webhooks/messenger  POST /webhooks/telegram
         │                         │
         └────────────┬────────────┘
                      ▼
            Express Server (Port 5000)
            - Validate Signature / Secret
            - In-Memory Deduplication & Store
                      │
                      ▼ Socket.IO Broadcast (`message:new`, `conversation:updated`)
             Browser Web Inbox (Vanilla JS)
             - Realtime Bubble Feed (Xanh dương: Messenger | Xanh da trời: Telegram)
             - Gửi phản hồi qua Official Send API tương ứng
```

---

## Cấu trúc thư mục

```text
messenger-realtime-demo/
├── public/
│   ├── index.html        ← Giao diện hộp thư 2 cột + bảng cài đặt Webhook Telegram
│   ├── style.css         ← Giao diện phân biệt màu sắc từng nền tảng
│   └── app.js            ← Socket.IO client, quản lý hội thoại, gửi nhận tin nhắn
├── src/
│   ├── app.js            ← Express + HTTP Server + Socket.IO bootstrap
│   ├── routes/
│   │   ├── webhook.routes.js          ← GET + POST /webhooks/messenger
│   │   ├── telegram.webhook.routes.js ← POST /webhooks/telegram
│   │   ├── messenger.routes.js        ← /api/conversations, /api/messages/send
│   │   └── telegram.routes.js         ← /api/telegram/* (send, set-webhook, me, info)
│   ├── controllers/
│   │   ├── webhook.controller.js      ← HMAC validation & xử lý tin Meta
│   │   └── telegram.controller.js     ← Secret validation & xử lý tin Telegram
│   ├── services/
│   │   └── messenger.service.js       ← Meta Graph API (Send, conversations, history)
│   │   └── telegram.service.js        ← Telegram Bot API (sendMessage, setWebhook)
│   └── store/
│       └── memory.store.js            ← In-memory Map store đa kênh (chống trùng tin)
├── tests/
│   └── webhook.test.js                ← Unit test kiểm tra xác thực webhook cả 2 nền tảng
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Hướng dẫn cài đặt & chạy Telegram

### 1. Chuẩn bị Bot Telegram
1. Mở ứng dụng Telegram, tìm `@BotFather`.
2. Gửi lệnh `/newbot`, đặt tên bot (ví dụ: `Unified Inbox Demo`).
3. Đặt username kết thúc bằng `bot` (ví dụ: `diid_inbox_test_bot`).
4. Nhận `Bot Token` từ BotFather.

### 2. Cấu hình file `.env`
Mở file `.env` và điền:
```env
PORT=5000

# Telegram
TELEGRAM_BOT_TOKEN=8839982963:AAFvfp6hSeAQInnjO0PINc-vXd_UkbFnk8o
TELEGRAM_WEBHOOK_SECRET=your_random_secret

# Meta (nếu dùng)
META_APP_ID=
META_APP_SECRET=
META_PAGE_ID=
META_PAGE_ACCESS_TOKEN=
META_VERIFY_TOKEN=unified_demo_verify_2026
META_GRAPH_VERSION=v26.0
```

### 3. Khởi động server
```bash
npm run dev
```

### 4. Bật ngrok
Trong terminal khác:
```bash
ngrok http 5000
```
Lấy URL HTTPS (ví dụ: `https://escapable-snaking-ideology.ngrok-free.dev`).

### 5. Đăng ký Webhook Telegram
Có 2 cách cực kỳ tiện lợi:

#### Cách 1: Đăng ký ngay trên giao diện web (Khuyên dùng)
1. Mở trình duyệt vào `http://localhost:5000`.
2. Ở sidebar bên trái, cạnh mục **TG Webhook**, bấm nút **"Cấu hình"**.
3. Dán URL ngrok của bạn vào ô input (ví dụ: `https://escapable-snaking-ideology.ngrok-free.dev`).
4. Bấm **"Lưu Webhook"**. Hệ thống sẽ tự động đăng ký với Telegram và báo `✓ Đã đăng ký thành công`.

#### Cách 2: Gọi bằng API / curl
```bash
curl -X POST http://localhost:5000/api/telegram/set-webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://escapable-snaking-ideology.ngrok-free.dev"}'
```

### 6. Thử nghiệm nhận và gửi tin nhắn
1. Mở Telegram, tìm bot của bạn (ví dụ: `@diid_inbox_test_bot`).
2. Bấm `Start` hoặc nhắn tin bất kỳ (ví dụ: `Xin chào`).
3. Tin nhắn xuất hiện **ngay lập tức** trên website trong thời gian thực mà không cần tải lại trang.
4. Nhấp vào hội thoại Telegram, gõ phản hồi và bấm **Gửi** (hoặc `Ctrl + Enter`).
5. Người dùng trên Telegram sẽ nhận được tin phản hồi từ bot ngay lập tức.

---

## API Reference

### Telegram
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/webhooks/telegram` | Nhận webhook từ Telegram (yêu cầu header secret token) |
| `GET`  | `/api/telegram/me` | Kiểm tra token & thông tin bot |
| `GET`  | `/api/telegram/webhook-info` | Kiểm tra trạng thái webhook hiện tại trên Telegram |
| `POST` | `/api/telegram/set-webhook` | Đăng ký webhook `{ url: "https://..." }` |
| `DELETE` | `/api/telegram/webhook` | Hủy đăng ký webhook |
| `POST` | `/api/telegram/send` | Gửi tin nhắn đến Telegram chat `{ chatId, text }` |
| `POST` | `/api/telegram/simulate` | Giả lập tin nhắn Telegram đến để test local |

### Facebook Messenger
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET`  | `/webhooks/messenger` | Meta challenge verification (`hub.challenge`) |
| `POST` | `/webhooks/messenger` | Nhận webhook sự kiện từ Meta (HMAC-SHA256 signature) |
| `GET`  | `/api/conversations` | Lấy danh sách hội thoại |
| `GET`  | `/api/conversations/:id/messages` | Lấy danh sách tin nhắn theo hội thoại |
| `POST` | `/api/messages/send` | Gửi tin nhắn phản hồi qua Meta Send API |

---

## Chạy Test tự động

```bash
npm test
```
Bộ test bao gồm:
- Xác thực Meta Webhook challenge (`GET /webhooks/messenger`)
- Xác thực HMAC SHA256 Meta Webhook (`POST /webhooks/messenger`)
- Xác thực bảo mật Secret Token Telegram (`POST /webhooks/telegram`)
- Lưu trữ tin nhắn & cập nhật hội thoại Telegram trong memory store
- Kiểm tra endpoint Health và Simulation
