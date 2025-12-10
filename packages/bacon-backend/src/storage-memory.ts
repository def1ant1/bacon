import { v4 as uuidv4 } from 'uuid'
import { ChatMessage, Sender, StorageAdapter, StoredFile } from './types'

function nowIso() {
  return new Date().toISOString()
}

/**
 * In-memory adapter with aggressive comments for enterprise readiness.
 */
export class MemoryStorage implements StorageAdapter {
  private messages = new Map<string, ChatMessage[]>()
  private files = new Map<string, StoredFile[]>()

  async recordMessage(sessionId: string, sender: Sender, text: string, maxHistory: number): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: uuidv4(),
      sessionId,
      sender,
      text,
      createdAt: nowIso(),
    }
    const arr = this.messages.get(sessionId) || []
    arr.push(msg)
    if (arr.length > maxHistory) arr.splice(0, arr.length - maxHistory)
    this.messages.set(sessionId, arr)
    return msg
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messages.get(sessionId) || []
  }

  async listSessions() {
    const out: { sessionId: string; count: number; lastAt: string | null; fileCount: number }[] = []
    for (const [sessionId, msgs] of this.messages.entries()) {
      const lastAt = msgs.at(-1)?.createdAt || null
      out.push({ sessionId, count: msgs.length, lastAt, fileCount: (this.files.get(sessionId) || []).length })
    }
    out.sort((a, b) => (a.lastAt && b.lastAt ? (a.lastAt < b.lastAt ? 1 : -1) : 0))
    return out
  }

  async clearSession(sessionId: string): Promise<void> {
    this.messages.delete(sessionId)
    this.files.delete(sessionId)
  }

  async saveFile(sessionId: string, info: { originalName: string; mimeType?: string; sizeBytes?: number; storagePath: string }): Promise<StoredFile> {
    const file: StoredFile = {
      id: uuidv4(),
      sessionId,
      originalName: info.originalName,
      mimeType: info.mimeType,
      sizeBytes: info.sizeBytes,
      storagePath: info.storagePath,
      createdAt: nowIso(),
      url: info.storagePath,
    }
    const arr = this.files.get(sessionId) || []
    arr.push(file)
    this.files.set(sessionId, arr)
    // Mirror upload as a user-visible message for transparency
    await this.recordMessage(sessionId, 'user', `Uploaded file: ${info.originalName}`, Number.MAX_SAFE_INTEGER)
    return file
  }

  async listFiles(sessionId: string): Promise<StoredFile[]> {
    return this.files.get(sessionId) || []
  }

  async deleteFile(id: string): Promise<void> {
    for (const [sessionId, files] of this.files.entries()) {
      const idx = files.findIndex((f) => f.id === id)
      if (idx >= 0) {
        files.splice(idx, 1)
        this.files.set(sessionId, files)
        break
      }
    }
  }

  async retentionSweep(retentionDays: number): Promise<void> {
    if (retentionDays <= 0) return
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    for (const [sessionId, msgs] of this.messages.entries()) {
      const kept = msgs.filter((m) => new Date(m.createdAt).getTime() >= cutoff)
      if (kept.length === 0) this.messages.delete(sessionId)
      else this.messages.set(sessionId, kept)
    }
  }
}
