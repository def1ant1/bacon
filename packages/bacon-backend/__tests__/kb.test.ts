import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/kb/chunking'
import { createKnowledgeBase } from '../src/kb/service'

const sample = `# FAQ\n\nWhat is bacon?\nBacon is delicious.\n\nHow do I cook it?\nSlowly.`

describe('knowledge base ingestion', () => {
  it('chunks text by paragraphs', () => {
    const chunks = chunkText(sample)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].content).toContain('FAQ')
  })

  it('ingests upload and allows retrieval', async () => {
    const kb = createKnowledgeBase()
    const ingest = await kb.ingestUpload({
      brandId: 'acme',
      botId: 'support',
      filename: 'faq.md',
      buffer: Buffer.from(sample),
    })
    expect(ingest.chunks.length).toBeGreaterThan(0)
    const retrieved = await kb.retrieve('cook bacon', { brandId: 'acme', botId: 'support', topK: 3 })
    expect(retrieved.chunks.length).toBeGreaterThan(0)
  })
})
