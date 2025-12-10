import { describe, expect, it, vi } from 'vitest'
import { AutomationRuleEngine, buildAutomationRule } from '../src/automation-rules'

const baseContext = { sessionId: 's1', text: 'hello checkout', source: 'message' as const }

function createExecutor() {
  const sent: any[] = []
  return {
    sent,
    executor: {
      async sendMessage(sessionId: string, action: any) {
        sent.push({ type: 'send', sessionId, action })
        return { id: 'm', sessionId, sender: 'bot', text: action.text, createdAt: new Date().toISOString() }
      },
      async invokeFlow(sessionId: string, action: any) {
        sent.push({ type: 'flow', sessionId, action })
      },
      async escalate(sessionId: string, action: any) {
        sent.push({ type: 'escalate', sessionId, action })
      },
    },
  }
}

describe('AutomationRuleEngine', () => {
  it('fires keyword rule and enqueues actions', async () => {
    const { executor, sent } = createExecutor()
    const engine = new AutomationRuleEngine({
      rules: [
        buildAutomationRule({
          id: 'kw',
          name: 'keywords',
          triggers: [{ type: 'keyword', keywords: ['checkout'] }],
          actions: [{ type: 'send_message', text: 'Need help finishing your cart?' }],
        }),
      ],
      executor,
    })

    await engine.handleMessageReceived(baseContext)

    expect(sent).toHaveLength(1)
    expect(sent[0].action.text).toContain('Need help')
  })

  it('applies debounce and rate limits', async () => {
    vi.useFakeTimers()
    const { executor, sent } = createExecutor()
    const engine = new AutomationRuleEngine({
      rules: [
        buildAutomationRule({
          id: 'debounce',
          triggers: [{ type: 'keyword', keywords: ['hello'] }],
          actions: [{ type: 'send_message', text: 'Hi there' }],
          debounceMs: 1000,
          rateLimit: { windowMs: 10_000, max: 2 },
        }),
      ],
      executor,
      clock: { now: () => vi.getMockedSystemTime() as number },
    })

    await engine.handleMessageReceived(baseContext)
    await engine.handleMessageReceived(baseContext)
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(1100)
    await engine.handleMessageReceived(baseContext)
    expect(sent).toHaveLength(2)

    // Third fire inside rate window should be dropped
    await engine.handleMessageReceived(baseContext)
    expect(sent).toHaveLength(2)
    vi.useRealTimers()
  })

  it('schedules inactivity follow-ups', async () => {
    vi.useFakeTimers()
    const { executor, sent } = createExecutor()
    const engine = new AutomationRuleEngine({
      rules: [
        buildAutomationRule({
          id: 'inactivity',
          triggers: [{ type: 'inactivity', inactivityMs: 500 }],
          actions: [{ type: 'send_message', text: 'Still there?' }],
        }),
      ],
      executor,
      clock: {
        now: () => vi.getMockedSystemTime() as number,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout,
      },
    })

    await engine.handleMessageReceived(baseContext)
    vi.advanceTimersByTime(600)
    await Promise.resolve()
    expect(sent.some((s) => s.action?.text === 'Still there?')).toBe(true)
    vi.useRealTimers()
  })
})
