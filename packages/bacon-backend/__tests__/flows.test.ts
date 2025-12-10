import { describe, expect, it } from 'vitest'
import { FlowEngine } from '../src/flows/engine'
import { MemoryFlowRepository } from '../src/flows/repository'
import { FlowDefinition } from '../src/flows/types'

describe('MemoryFlowRepository', () => {
  it('enforces optimistic locking on update', async () => {
    const repo = new MemoryFlowRepository()
    const base: Omit<FlowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'> = {
      botId: 'bot-1',
      name: 'Test Flow',
      description: 'locks',
      nodes: [],
      edges: [],
      createdBy: 'tester',
      updatedBy: 'tester',
    }
    const created = await repo.create(base)
    const updated = await repo.update({ ...created, name: 'Updated name' })
    await expect(repo.update({ ...created, name: 'stale update' })).rejects.toThrow('version_conflict')
    expect(updated.version).toBe(2)
  })
})

describe('FlowEngine', () => {
  const sampleFlow: FlowDefinition = {
    id: 'flow1',
    botId: 'bot-1',
    name: 'Branching',
    description: 'exercise conditional branching',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 'start', type: 'start', config: { nextNodeId: 'condition' }, name: 'Start' },
      { id: 'condition', type: 'condition', config: { when: 'flag:vip', trueTarget: 'llm-vip', falseTarget: 'llm-std' } },
      { id: 'llm-vip', type: 'llm', config: { mockResponse: 'hello vip' } },
      { id: 'llm-std', type: 'llm', config: { mockResponse: 'hello' } },
      { id: 'end', type: 'end', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'llm-vip', target: 'end' },
      { id: 'e2', source: 'llm-std', target: 'end' },
    ],
  }

  it('routes through true branch when flag set', async () => {
    const engine = new FlowEngine()
    const result = await engine.run(sampleFlow, { botId: 'bot-1', input: {}, vars: { vip: true } })
    const completedIds = result.trace.map((t) => t.nodeId)
    expect(completedIds).toContain('llm-vip')
    expect(completedIds).not.toContain('llm-std')
  })

  it('routes through false branch when flag missing', async () => {
    const engine = new FlowEngine()
    const result = await engine.run(sampleFlow, { botId: 'bot-1', input: {}, vars: {} })
    const completedIds = result.trace.map((t) => t.nodeId)
    expect(completedIds).toContain('llm-std')
  })
})
