import { randomUUID } from 'crypto'

/**
 * Basic chunker that prefers paragraph boundaries and keeps chunks under ~1k characters.
 * This is intentionally deterministic to keep tests stable while avoiding vendor lock-in.
 */
export function chunkText(text: string, opts?: { maxLen?: number }): { id: string; content: string; tokenEstimate: number; order: number }[] {
  const maxLen = opts?.maxLen ?? 1000
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const paragraphs = normalized.split(/\n{2,}/)
  const chunks: { id: string; content: string; tokenEstimate: number; order: number }[] = []
  let order = 0
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue
    if (trimmed.length <= maxLen) {
      chunks.push({ id: randomUUID(), content: trimmed, tokenEstimate: estimateTokens(trimmed), order: order++ })
      continue
    }
    // Soft wrap long paragraphs
    for (let i = 0; i < trimmed.length; i += maxLen) {
      const slice = trimmed.slice(i, i + maxLen)
      chunks.push({ id: randomUUID(), content: slice, tokenEstimate: estimateTokens(slice), order: order++ })
    }
  }
  return chunks
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.split(/\s+/).length * 1.2))
}
