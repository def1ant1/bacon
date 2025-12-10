Chatbot1 Example with Postgres Persistence

Quick start
- cd this `example` folder
- Copy `.env.example` to `.env` and set `DATABASE_URL` for your Postgres instance
- `npm install`
- `npm run dev` (opens browser). The app uses the chat widget, Admin at `/admin.html`, and Monitor WebUI at `/webui.html`.

What it stores
- Conversations: `chat_sessions`, `chat_messages`
- Files: `chat_files` (stored on disk under `example/uploads`, path saved in DB)

Endpoints
- `POST /api/chat` — accepts `{ sessionId, message, userIdentifier? }`, persists messages, returns `{ reply }`
- `POST /api/upload` — multipart upload: `file` + `sessionId`, stores file and records a message
- `GET /api/admin/sessions` — list sessions with counts and last activity
- `GET /api/admin/messages?sessionId=...` — list messages for a session
- `DELETE /api/admin/messages?sessionId=...` — clear session
- `GET /api/admin/settings`, `PUT /api/admin/settings`, `POST /api/admin/settings/reset` — admin config

Notes
- If `DATABASE_URL` is not set or `pg` is unavailable, the dev server falls back to in-memory storage so you can still run the demo.
- Uploaded files are served under `/uploads/<filename>` and stored in `example/uploads/`.

