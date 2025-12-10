import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

// Optional Postgres + env loader
let Pool: any = null
try {
  // Lazy require so Vite config loads even if deps not installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ;({ Pool } = await import('pg'))
} catch {}

try {
  // Load .env if available
  const __filename_env = fileURLToPath(import.meta.url)
  const __dirname_env = path.dirname(__filename_env)
  const envPath = path.join(__dirname_env, '.env')
  const dotenv = await import('dotenv')
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
} catch {}

// Vite dev server config with a mock backend + simple admin WebUI endpoints
export default defineConfig({
  server: {
    open: true,
  },
  plugins: [
    {
      name: 'mock-chat-api-and-admin-webui',
      configureServer(server) {
        // --- persistence helpers for admin settings ---
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = path.dirname(__filename)
        const dataDir = path.join(__dirname, '.data')
        const settingsFile = path.join(dataDir, 'admin-settings.json')

        const defaultSettings = {
          general: {
            title: 'Support',
            defaultOpen: true,
            welcomeMessage: 'Hi! How can I help?',
            launcherPosition: 'bottom-right' as 'bottom-right' | 'bottom-left',
          },
          branding: {
            primaryColor: '#2563eb',
            customCss: '',
          },
          behavior: {
            replyDelayMs: 600,
            maxHistory: 200,
          },
          integrations: {
            apiUrl: '/api/chat',
            apiAuthHeader: '',
            webhookUrl: '',
          },
          security: {
            dataRetentionDays: 30,
            allowedOrigins: ['*'],
          },
          ai: {
            provider: 'echo' as 'echo' | 'openai' | 'ollama',
            systemPrompt: 'You are a helpful customer support assistant.',
            temperature: 0.2,
            maxTokens: 256,
            topP: 1,
            openai: {
              apiKey: '',
              baseUrl: 'https://api.openai.com/v1',
              chatModel: 'gpt-4o-mini',
              embeddingModel: 'text-embedding-3-small',
            },
            ollama: {
              host: 'http://localhost:11434',
              chatModel: 'llama3',
              embeddingModel: 'nomic-embed-text',
            },
            rag: {
              enabled: false,
              topK: 5,
              namespace: 'default',
              useInChat: true,
              filterBySession: true,
            },
          },
          vector: {
            pinecone: {
              apiKey: '',
              indexHost: '',
              namespace: 'default',
              topK: 5,
            },
          },
        }

        function ensureDir(p: string) {
          if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
        }

        function clone(obj: any) { return JSON.parse(JSON.stringify(obj)) }

        function readSettings() {
          try {
            const txt = fs.readFileSync(settingsFile, 'utf8')
            const obj = JSON.parse(txt)
            return deepMerge(clone(defaultSettings), obj)
          } catch {
            return clone(defaultSettings)
          }
        }

        function writeSettings(s: any) {
          ensureDir(dataDir)
          fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2), 'utf8')
        }

        function deepMerge(target: any, source: any) {
          for (const k of Object.keys(source || {})) {
            const sv = source[k]
            const tv = target[k]
            if (
              sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object'
            ) {
              target[k] = deepMerge({ ...tv }, sv)
            } else {
              target[k] = sv
            }
          }
          return target
        }

        let settings = readSettings()

        // --- Storage backends ---
        const USE_DB = !!(process.env.DATABASE_URL && Pool)

        // In-memory fallback store (used if no DATABASE_URL)
        type Msg = { id: string; sender: 'user' | 'bot'; text: string; createdAt: string }
        const memStore = new Map<string, Msg[]>() // sessionId -> messages
        type FileRec = { id: string; sessionId: string; originalName: string; mimeType?: string; sizeBytes?: number; storagePath: string; createdAt: string }
        const memFiles = new Map<string, FileRec[]>() // sessionId -> files

        // Ensure uploads dir exists
        const uploadsDir = path.join(__dirname, 'uploads')
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

        // --- Postgres setup ---
        const pool = USE_DB ? new Pool({ connectionString: process.env.DATABASE_URL }) : null

        async function ensureSchema() {
          if (!USE_DB) return
          await pool.query(`
            create table if not exists conversations (
              id bigserial primary key,
              session_id text unique not null,
              created_at timestamptz not null default now(),
              last_activity_at timestamptz not null default now()
            );

            create table if not exists chat_sessions (
              session_id text primary key,
              created_at timestamptz not null default now(),
              last_activity_at timestamptz not null default now()
            );

            create table if not exists chat_messages (
              id bigserial primary key,
              session_id text not null references chat_sessions(session_id) on delete cascade,
              sender text not null check (sender in ('user','bot')),
              text text not null,
              created_at timestamptz not null default now()
            );

            create table if not exists chat_files (
              id bigserial primary key,
              session_id text not null references chat_sessions(session_id) on delete cascade,
              original_name text not null,
              mime_type text,
              size_bytes bigint,
              storage_path text not null,
              created_at timestamptz not null default now()
            );
          `)
          // Backfill conversations from legacy chat_sessions if needed
          await pool.query(`
            insert into conversations(session_id, created_at, last_activity_at)
            select s.session_id, s.created_at, s.last_activity_at
              from chat_sessions s
         on conflict (session_id) do nothing
          `)
        }

        async function dbEnsureConversation(sessionId: string): Promise<{ id: number }> {
          await ensureSchema()
          // Upsert into canonical conversations table
          const insertConv = await pool.query(
            `insert into conversations(session_id) values($1)
             on conflict (session_id) do update set last_activity_at = now()
             returning id`,
            [sessionId]
          )
          const id = Number(insertConv.rows[0].id)
          // Maintain legacy chat_sessions for compatibility
          await pool.query(
            `insert into chat_sessions(session_id) values($1)
             on conflict (session_id) do update set last_activity_at = now()`,
            [sessionId]
          )
          return { id }
        }

        async function dbInsertMessage(sessionId: string, sender: 'user'|'bot', text: string) {
          await ensureSchema()
          await pool.query('begin')
          try {
            const conv = await dbEnsureConversation(sessionId)
            await pool.query(
              `insert into chat_messages(session_id, sender, text) values ($1,$2,$3)`,
              [sessionId, sender, text]
            )
            await pool.query(
              `update chat_sessions set last_activity_at = now() where session_id = $1`,
              [sessionId]
            )
            await pool.query(`update conversations set last_activity_at = now() where id = $1`, [conv.id])
            await pool.query('commit')
          } catch (e) {
            await pool.query('rollback')
            throw e
          }
        }

        async function dbListSessions() {
          await ensureSchema()
          const { rows } = await pool.query(
            `with file_counts as (
               select session_id, count(*) as c from chat_files group by session_id
             )
             select c.id as "id",
                    c.session_id as "sessionId",
                    count(m.id) as count,
                    coalesce(max(m.created_at), c.last_activity_at) as "lastAt",
                    coalesce(fc.c, 0) as "fileCount"
               from conversations c
               left join chat_messages m on m.session_id = c.session_id
               left join file_counts fc on fc.session_id = c.session_id
           group by c.id, c.session_id, c.last_activity_at, fc.c
           order by "lastAt" desc nulls last`
          )
          return rows
        }

        async function dbListMessages(sessionId: string) {
          await ensureSchema()
          const { rows } = await pool.query(
            `select id, session_id as "sessionId", sender, text,
                    to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
               from chat_messages
              where session_id = $1
           order by id asc`,
            [sessionId]
          )
          return rows.map((r: any) => ({ id: String(r.id), sender: r.sender, text: r.text, createdAt: r.createdAt }))
        }

        async function dbClearSession(sessionId: string) {
          await ensureSchema()
          await pool.query('delete from chat_files where session_id = $1', [sessionId])
          await pool.query('delete from chat_messages where session_id = $1', [sessionId])
          await pool.query('delete from chat_sessions where session_id = $1', [sessionId])
          await pool.query('delete from conversations where session_id = $1', [sessionId])
        }

        async function dbInsertFile(sessionId: string, info: { originalName: string; mimeType?: string; sizeBytes?: number; storagePath: string }) {
          await ensureSchema()
          await dbEnsureConversation(sessionId)
          await pool.query(
            `insert into chat_files(session_id, original_name, mime_type, size_bytes, storage_path)
             values ($1,$2,$3,$4,$5)`,
            [sessionId, info.originalName, info.mimeType || null, info.sizeBytes || null, info.storagePath]
          )
          // Also add a message indicating an upload occurred
          await dbInsertMessage(sessionId, 'user', `Uploaded file: ${info.originalName}`)
        }

        async function dbListFiles(sessionId: string) {
          await ensureSchema()
          const { rows } = await pool.query(
            `select id,
                    session_id as "sessionId",
                    original_name as "originalName",
                    mime_type as "mimeType",
                    size_bytes as "sizeBytes",
                    storage_path as "storagePath",
                    to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
               from chat_files
              where session_id = $1
           order by id asc`,
            [sessionId]
          )
          return rows.map((r: any) => ({ ...r, url: r.storagePath }))
        }

        function sendJson(res: any, obj: any, status = 200) {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
        }

        // --- AI helpers ---
        async function aiEmbed(texts: string[]): Promise<number[][]> {
          const prov = settings.ai?.provider || 'echo'
          if ((settings.ai?.openai?.apiKey || process.env.OPENAI_API_KEY) && settings.ai?.openai?.embeddingModel && prov === 'openai') {
            const base = (settings.ai.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
            const r = await fetch(base + '/embeddings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.ai.openai.apiKey || process.env.OPENAI_API_KEY}`,
              },
              body: JSON.stringify({ model: settings.ai.openai.embeddingModel, input: texts }),
            })
            const j = await r.json()
            if (!r.ok) throw new Error('OpenAI embeddings error: ' + (j?.error?.message || r.status))
            return j.data.map((d: any) => d.embedding)
          }
          if (settings.ai?.ollama?.host && settings.ai?.ollama?.embeddingModel && prov === 'ollama') {
            const host = settings.ai.ollama.host.replace(/\/$/, '')
            const out: number[][] = []
            for (const t of texts) {
              const r = await fetch(host + '/api/embeddings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: settings.ai.ollama.embeddingModel, prompt: t }),
              })
              const j = await r.json()
              if (!r.ok) throw new Error('Ollama embeddings error: ' + r.status)
              out.push(j.embedding)
            }
            return out
          }
          // echo provider fallback: random small vectors (dev only)
          return texts.map(() => Array.from({ length: 8 }, () => Math.random()))
        }

        async function aiChatComplete(sessionId: string, userMsg: string, history: { role: 'user' | 'assistant' | 'system'; content: string }[]) {
          const prov = settings.ai?.provider || 'echo'
          const sys = settings.ai?.systemPrompt || 'You are a helpful assistant.'
          const temperature = Number(settings.ai?.temperature ?? 0.2)
          const maxTokens = Number(settings.ai?.maxTokens ?? 256)

          if (prov === 'openai' && (settings.ai?.openai?.apiKey || process.env.OPENAI_API_KEY)) {
            const base = (settings.ai.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
            const messages = [{ role: 'system', content: sys }, ...history, { role: 'user', content: userMsg }]
            const r = await fetch(base + '/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.ai.openai.apiKey || process.env.OPENAI_API_KEY}`,
              },
              body: JSON.stringify({ model: settings.ai.openai.chatModel || 'gpt-4o-mini', temperature, max_tokens: maxTokens, messages }),
            })
            const j = await r.json()
            if (!r.ok) throw new Error('OpenAI chat error: ' + (j?.error?.message || r.status))
            return String(j.choices?.[0]?.message?.content || '')
          }
          if (prov === 'ollama' && settings.ai?.ollama?.host) {
            const host = settings.ai.ollama.host.replace(/\/$/, '')
            const messages = [{ role: 'system', content: sys }, ...history, { role: 'user', content: userMsg }]
            const r = await fetch(host + '/api/chat', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: settings.ai.ollama.chatModel || 'llama3', messages, options: { temperature } }),
            })
            const j = await r.json()
            if (!r.ok) throw new Error('Ollama chat error: ' + r.status)
            return String(j.message?.content || j?.messages?.at(-1)?.content || '')
          }
          return userMsg ? `Echo: ${userMsg}` : 'Hello! How can I help today?'
        }

        // --- Pinecone helpers ---
        function pineconeHeaders() {
          const key = settings.vector?.pinecone?.apiKey || process.env.PINECONE_API_KEY
          if (!key) throw new Error('Pinecone API key not set')
          return { 'Content-Type': 'application/json', 'Api-Key': key }
        }

        async function pineconeUpsert(vectors: any[]) {
          const host = (settings.vector?.pinecone?.indexHost || '').replace(/\/$/, '')
          if (!host) throw new Error('Pinecone index host not set')
          const ns = settings.vector?.pinecone?.namespace || 'default'
          const r = await fetch(host + '/vectors/upsert', {
            method: 'POST', headers: pineconeHeaders(),
            body: JSON.stringify({ vectors, namespace: ns }),
          })
          if (!r.ok) throw new Error('Pinecone upsert failed: ' + r.status)
          return r.json()
        }

        async function pineconeQuery(vector: number[], opts?: { topK?: number; sessionId?: string }) {
          const host = (settings.vector?.pinecone?.indexHost || '').replace(/\/$/, '')
          if (!host) throw new Error('Pinecone index host not set')
          const ns = settings.vector?.pinecone?.namespace || 'default'
          const k = Number(opts?.topK || settings.vector?.pinecone?.topK || settings.ai?.rag?.topK || 5)
          const filter = settings.ai?.rag?.filterBySession && opts?.sessionId ? { sessionId: opts.sessionId } : undefined
          const r = await fetch(host + '/query', {
            method: 'POST', headers: pineconeHeaders(),
            body: JSON.stringify({ vector, topK: k, includeMetadata: true, namespace: ns, filter }),
          })
          const j = await r.json()
          if (!r.ok) throw new Error('Pinecone query failed: ' + r.status)
          return j
        }

        // Simple retention job based on settings.security.dataRetentionDays
        const retentionTimer = setInterval(() => {
          try {
            const days = Number(settings.security?.dataRetentionDays ?? 30)
            const cutoff = Date.now() - days * 24 * 3600 * 1000
            for (const [sid, msgs] of store.entries()) {
              const last = msgs.at(-1)?.createdAt
              if (last && new Date(last).getTime() < cutoff) {
                store.delete(sid)
              }
            }
          } catch {}
        }, 60_000)
        // Vite will dispose plugins on restart; no need to clearInterval explicitly

        server.middlewares.use(async (req, res, next) => {
          try {
            const url = new URL(req.url || '/', 'http://localhost')
            // POST /api/chat
            if (req.method === 'POST' && url.pathname === '/api/chat') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              const bodyStr = Buffer.concat(chunks).toString('utf8')
              const body = bodyStr ? JSON.parse(bodyStr) : {}
              const sessionId: string = body?.sessionId || 'session-dev'
              const userMsg: string = String(body?.message ?? '')

              const now = () => new Date().toISOString()

              // Persist user message
              if (userMsg.trim()) {
                if (USE_DB) await dbInsertMessage(sessionId, 'user', userMsg)
                else {
                  const arr = memStore.get(sessionId) || []
                  arr.push({ id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`, sender: 'user', text: userMsg, createdAt: now() })
                  memStore.set(sessionId, arr)
                }
              }

              // Build history for AI
              const getHistory = async () => {
                if (USE_DB) return await dbListMessages(sessionId)
                return memStore.get(sessionId) || []
              }

              // Base reply
              let replyText = userMsg.trim() ? `Echo: ${userMsg}` : 'Hello! How can I help today?'

              try {
                // Optionally do RAG with Pinecone
                let context = ''
                if (settings.ai?.rag?.enabled && settings.ai?.rag?.useInChat) {
                  const [emb] = await aiEmbed([userMsg])
                  const q = await pineconeQuery(emb, { topK: settings.ai.rag.topK, sessionId })
                  const parts = (q.matches || []).map((m: any) => m.metadata?.text || '').filter(Boolean)
                  if (parts.length) context = 'Relevant context:\n' + parts.join('\n---\n') + '\n\n'
                }

                const hist = (await getHistory()).slice(-10).map((m: any) => ({
                  role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
                  content: m.text,
                }))
                const content = context ? context + userMsg : userMsg
                replyText = await aiChatComplete(sessionId, content, hist)
              } catch (e) {
                // Fall back to echo if AI errors
                replyText = userMsg.trim() ? `Echo: ${userMsg}` : 'Hello! How can I help today?'
              }
              const delayMs = Number(settings.behavior?.replyDelayMs ?? 0)

              const finalize = async () => {
                if (USE_DB) await dbInsertMessage(sessionId, 'bot', replyText)
                else {
                  const arr = memStore.get(sessionId) || []
                  arr.push({ id: `bot_${Date.now()}_${Math.random().toString(16).slice(2)}`, sender: 'bot', text: replyText, createdAt: now() })
                  const maxHistory = Number(settings.behavior?.maxHistory ?? 200)
                  if (arr.length > maxHistory) arr.splice(0, arr.length - maxHistory)
                  memStore.set(sessionId, arr)
                }
                sendJson(res, { reply: replyText })
              }

              if (delayMs > 0) setTimeout(() => { finalize().catch(() => {}) }, delayMs)
              else await finalize()
              return
            }

            // GET /api/admin/sessions -> [{ sessionId, count, lastAt }]
            if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
              if (USE_DB) {
                const list = await dbListSessions()
                return sendJson(res, list)
              } else {
                const list = Array.from(memStore.entries()).map(([sessionId, msgs]) => ({
                  sessionId,
                  count: msgs.length,
                  lastAt: msgs.at(-1)?.createdAt ?? null,
                  fileCount: (memFiles.get(sessionId) || []).length,
                }))
                list.sort((a, b) => (a.lastAt && b.lastAt ? (a.lastAt < b.lastAt ? 1 : -1) : 0))
                return sendJson(res, list)
              }
            }

            // GET /api/admin/messages?sessionId=...
            if (req.method === 'GET' && url.pathname === '/api/admin/messages') {
              const sessionId = url.searchParams.get('sessionId') || ''
              if (USE_DB) {
                const msgs = await dbListMessages(sessionId)
                return sendJson(res, msgs)
              } else {
                const msgs = memStore.get(sessionId) || []
                return sendJson(res, msgs)
              }
            }

            // DELETE /api/admin/messages?sessionId=... (clear a session)
            if (req.method === 'DELETE' && url.pathname === '/api/admin/messages') {
              const sessionId = url.searchParams.get('sessionId') || ''
              if (USE_DB) await dbClearSession(sessionId)
              else memStore.delete(sessionId)
              return sendJson(res, { ok: true })
            }

            // POST /api/admin/send -> add a bot message to a session
            if (req.method === 'POST' && url.pathname === '/api/admin/send') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              const bodyStr = Buffer.concat(chunks).toString('utf8')
              const body = bodyStr ? JSON.parse(bodyStr) : {}
              const sessionId = String(body?.sessionId || '')
              const text = String(body?.text || '')
              if (!sessionId || !text.trim()) return sendJson(res, { error: 'Missing sessionId or text' }, 400)
              if (USE_DB) await dbInsertMessage(sessionId, 'bot', text)
              else {
                const now = () => new Date().toISOString()
                const arr = memStore.get(sessionId) || []
                arr.push({ id: `bot_${Date.now()}_${Math.random().toString(16).slice(2)}`, sender: 'bot', text, createdAt: now() })
                memStore.set(sessionId, arr)
              }
              return sendJson(res, { ok: true })
            }

            // POST /api/upload (multipart/form-data)
            if (req.method === 'POST' && url.pathname === '/api/upload') {
              // Lazy import busboy
              const { default: Busboy } = await import('busboy')
              const bb = Busboy({ headers: req.headers })
              let sessionId = 'session-dev'
              let savedFiles: any[] = []
              let pendingWrites = 0
              let finished = false

              bb.on('field', (name: string, val: string) => {
                if (name === 'sessionId') sessionId = String(val || 'session-dev')
              })

              bb.on('file', (name: string, file: NodeJS.ReadableStream, info: any) => {
                const { filename, mimeType } = info
                const safeBase = filename?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload'
                const unique = `${Date.now()}_${Math.random().toString(16).slice(2)}`
                const filePath = path.join(uploadsDir, `${unique}_${safeBase}`)
                const out = fs.createWriteStream(filePath)
                let total = 0
                file.on('data', (d: Buffer) => { total += d.length })
                pendingWrites++
                file.pipe(out)
                out.on('close', async () => {
                  const relPath = '/uploads/' + path.basename(filePath)
                  if (USE_DB) {
                    await dbInsertFile(sessionId, { originalName: filename, mimeType, sizeBytes: total, storagePath: relPath })
                  } else {
                    // memory mode: store message mention only
                    const now = () => new Date().toISOString()
                    const m = memStore.get(sessionId) || []
                    m.push({ id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`, sender: 'user', text: `Uploaded file: ${filename}`, createdAt: now() })
                    memStore.set(sessionId, m)

                    const files = memFiles.get(sessionId) || []
                    files.push({ id: `${Date.now()}`, sessionId, originalName: filename, mimeType, sizeBytes: total, storagePath: relPath, createdAt: now() })
                    memFiles.set(sessionId, files)
                  }
                  savedFiles.push({ filename, mimeType, size: total, url: relPath })
                  // Background index into Pinecone
                  try { indexFileToPinecone(sessionId, filePath, filename, mimeType).catch(() => {}) } catch {}
                  pendingWrites--
                  if (finished && pendingWrites === 0) {
                    return sendJson(res, { ok: true, files: savedFiles })
                  }
                })
              })

              bb.on('finish', () => {
                finished = true
                if (pendingWrites === 0) {
                  return sendJson(res, { ok: true, files: savedFiles })
                }
              })

              req.pipe(bb)
              return
            }

            // Serve uploaded files
            if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
              const p = url.pathname.replace(/^\/+/, '')
              const f = path.join(__dirname, p)
              if (!f.startsWith(uploadsDir)) { res.statusCode = 403; return res.end('Forbidden') }
              if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('Not found') }
              const stream = fs.createReadStream(f)
              stream.pipe(res)
              return
            }

            // GET /api/admin/files?sessionId=...
            if (req.method === 'GET' && url.pathname === '/api/admin/files') {
              const sessionId = url.searchParams.get('sessionId') || ''
              if (USE_DB) {
                const list = await dbListFiles(sessionId)
                return sendJson(res, list)
              } else {
                const list = (memFiles.get(sessionId) || []).map(f => ({ ...f, url: f.storagePath }))
                return sendJson(res, list)
              }
            }

            // DELETE /api/admin/file?id=123
            if (req.method === 'DELETE' && url.pathname === '/api/admin/file') {
              const id = url.searchParams.get('id') || ''
              if (!id) return sendJson(res, { error: 'Missing id' }, 400)
              if (USE_DB) {
                const { rows } = await pool.query('select storage_path from chat_files where id = $1', [id])
                const fileRow = rows[0]
                await pool.query('delete from chat_files where id = $1', [id])
                if (fileRow?.storage_path) {
                  const f = path.join(__dirname, fileRow.storage_path.replace(/^\/+/, ''))
                  try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
                }
              } else {
                // remove from memFiles and try to remove file
                for (const [sid, arr] of memFiles.entries()) {
                  const idx = arr.findIndex(x => String(x.id) === String(id))
                  if (idx >= 0) {
                    const [rec] = arr.splice(idx, 1)
                    memFiles.set(sid, arr)
                    const f = path.join(__dirname, rec.storagePath.replace(/^\/+/, ''))
                    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {}
                    break
                  }
                }
              }
              return sendJson(res, { ok: true })
            }

            // GET /api/chat?sessionId=...
            if (req.method === 'GET' && url.pathname === '/api/chat') {
              const sessionId = url.searchParams.get('sessionId') || ''
              if (!sessionId) return sendJson(res, { error: 'Missing sessionId' }, 400)
              if (USE_DB) {
                const msgs = await dbListMessages(sessionId)
                return sendJson(res, msgs)
              } else {
                const msgs = memStore.get(sessionId) || []
                return sendJson(res, msgs)
              }
            }

            // POST /api/vector/upsert-messages { sessionId, limit? }
            if (req.method === 'POST' && url.pathname === '/api/vector/upsert-messages') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              const bodyStr = Buffer.concat(chunks).toString('utf8')
              const body = bodyStr ? JSON.parse(bodyStr) : {}
              const sessionId = String(body?.sessionId || '')
              const limit = Number(body?.limit || 20)
              if (!sessionId) return sendJson(res, { error: 'Missing sessionId' }, 400)
              const msgs = USE_DB ? await dbListMessages(sessionId) : (memStore.get(sessionId) || [])
              const last = msgs.slice(-limit)
              const texts = last.map((m: any) => `${m.sender}: ${m.text}`)
              const embeds = await aiEmbed(texts)
              const vectors = embeds.map((values, i) => ({ id: `${sessionId}:${Date.now()}:${i}`, values, metadata: { text: texts[i], sessionId } }))
              const r = await pineconeUpsert(vectors)
              return sendJson(res, { ok: true, upserted: vectors.length, result: r })
            }

            // POST /api/vector/query { sessionId, query, topK? }
            if (req.method === 'POST' && url.pathname === '/api/vector/query') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              const bodyStr = Buffer.concat(chunks).toString('utf8')
              const body = bodyStr ? JSON.parse(bodyStr) : {}
              const query = String(body?.query || '')
              const topK = Number(body?.topK || 5)
              const sessionId = body?.sessionId ? String(body.sessionId) : undefined
              if (!query) return sendJson(res, { error: 'Missing query' }, 400)
              const [emb] = await aiEmbed([query])
              const r = await pineconeQuery(emb, { topK, sessionId })
              return sendJson(res, r)
            }

            // GET /api/admin/settings
            if (req.method === 'GET' && url.pathname === '/api/admin/settings') {
              return sendJson(res, settings)
            }

            // PUT /api/admin/settings
            if (req.method === 'PUT' && url.pathname === '/api/admin/settings') {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(chunk as Buffer)
              const bodyStr = Buffer.concat(chunks).toString('utf8')
              const incoming = bodyStr ? JSON.parse(bodyStr) : {}
              const merged = deepMerge(clone(defaultSettings), incoming)
              settings = merged
              try { writeSettings(settings) } catch {}
              return sendJson(res, { ok: true })
            }

            // POST /api/admin/settings/reset
            if (req.method === 'POST' && url.pathname === '/api/admin/settings/reset') {
              settings = clone(defaultSettings)
              try { writeSettings(settings) } catch {}
              return sendJson(res, { ok: true })
            }

            // POST /api/admin/db/init -> run schema/migrations
            if (req.method === 'POST' && url.pathname === '/api/admin/db/init') {
              try {
                await ensureSchema()
                // Touch legacy + conv tables to ensure exist
                if (USE_DB) {
                  await pool.query('select 1')
                }
                return sendJson(res, { ok: true })
              } catch (e: any) {
                return sendJson(res, { ok: false, error: String(e?.message || e) }, 500)
              }
            }

            return next()
          } catch (e) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: 'Server error in mock API.' }))
          }
        })
      },
    },
  ],
})
        function chunkText(input: string, size = 1200, overlap = 200) {
          const clean = String(input || '').replace(/\s+/g, ' ').trim()
          if (!clean) return [] as string[]
          const chunks: string[] = []
          let i = 0
          while (i < clean.length) {
            const end = Math.min(clean.length, i + size)
            chunks.push(clean.slice(i, end))
            if (end >= clean.length) break
            i = Math.max(0, end - overlap)
          }
          return chunks
        }

        async function extractTextFromFile(absPath: string, mimeType?: string, originalName?: string): Promise<string> {
          const lower = (mimeType || '').toLowerCase()
          const ext = path.extname(originalName || absPath).toLowerCase()
          try {
            if (lower.includes('pdf') || ext === '.pdf') {
              const { default: pdfParse } = await import('pdf-parse') as any
              const data = fs.readFileSync(absPath)
              const out = await pdfParse(data)
              return String(out.text || '')
            }
            if (lower.includes('word') || ext === '.docx') {
              const { default: mammoth } = await import('mammoth') as any
              const buf = fs.readFileSync(absPath)
              const res = await mammoth.convertToHtml({ buffer: buf })
              const html = res.value || ''
              const { load } = await import('cheerio') as any
              const $ = load(html)
              return $('body').text()
            }
            if (lower.includes('html') || ext === '.html' || ext === '.htm') {
              const html = fs.readFileSync(absPath, 'utf8')
              const { load } = await import('cheerio') as any
              const $ = load(html)
              return $('body').text()
            }
            // Default: read as utf8 text (may contain binary; we try)
            return fs.readFileSync(absPath, 'utf8')
          } catch {
            return ''
          }
        }

        async function indexFileToPinecone(sessionId: string, absPath: string, originalName: string, mimeType?: string) {
          if (!settings.ai?.rag?.enabled || !settings.vector?.pinecone?.indexHost) return
          // Extract and chunk
          const text = await extractTextFromFile(absPath, mimeType, originalName)
          if (!text) return
          const chunks = chunkText(text)
          // Embed and upsert in batches of 16
          const batchSize = 16
          for (let i = 0; i < chunks.length; i += batchSize) {
            const slice = chunks.slice(i, i + batchSize)
            const embeddings = await aiEmbed(slice)
            const vectors = embeddings.map((values, j) => ({
              id: `${sessionId}:file:${Date.now()}:${i + j}`,
              values,
              metadata: { text: slice[j], sessionId, source: 'file', fileName: originalName },
            }))
            await pineconeUpsert(vectors)
          }
        }
