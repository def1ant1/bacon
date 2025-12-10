import { v4 as uuidv4 } from 'uuid'
import { ChatMessage, RichMessagePayload } from './types'

export type AutomationTrigger =
  | { type: 'keyword'; keywords: string[]; match?: 'any' | 'all' }
  | { type: 'inactivity'; inactivityMs: number }
  | { type: 'scheduled'; cron?: string; intervalMs?: number; startAt?: number }
  | { type: 'page_metadata'; path?: string; tags?: string[]; attributes?: Record<string, string> }

export type AutomationAction =
  | { type: 'send_message'; text: string; payload?: RichMessagePayload }
  | { type: 'invoke_flow'; flowId: string; input?: Record<string, any> }
  | { type: 'escalate'; reason?: string; tags?: string[]; priority?: 'low' | 'normal' | 'high' }

export interface AutomationRule {
  id: string
  name: string
  triggers: AutomationTrigger[]
  actions: AutomationAction[]
  enabled?: boolean
  description?: string
  debounceMs?: number
  rateLimit?: { windowMs: number; max: number }
}

export interface AutomationEventContext {
  sessionId: string
  text?: string
  metadata?: Record<string, any>
  source?: 'message' | 'timer' | 'schedule'
}

export interface AutomationActionExecutor {
  sendMessage(sessionId: string, action: Extract<AutomationAction, { type: 'send_message' }>): Promise<ChatMessage>
  invokeFlow(sessionId: string, action: Extract<AutomationAction, { type: 'invoke_flow' }>): Promise<void>
  escalate(sessionId: string, action: Extract<AutomationAction, { type: 'escalate' }>, context?: AutomationEventContext): Promise<void>
}

export interface AutomationRuntimeConfig {
  rules?: AutomationRule[]
  engine?: AutomationRuleEngine
  executor?: AutomationActionExecutor
  clock?: { now(): number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout }
}

function now(clock?: { now(): number }) {
  return clock?.now?.() ?? Date.now()
}

class InMemoryRuleStore {
  private rules = new Map<string, AutomationRule>()

  constructor(initial: AutomationRule[] = []) {
    initial.forEach((rule) => this.rules.set(rule.id, rule))
  }

  list(): AutomationRule[] {
    return Array.from(this.rules.values())
  }
}

export class AutomationRuleEngine {
  private store: InMemoryRuleStore
  private executor: AutomationActionExecutor
  private inactivityTimers = new Map<string, NodeJS.Timeout>()
  private scheduledTimers: NodeJS.Timeout[] = []
  private lastFired = new Map<string, number>()
  private rateWindows = new Map<string, number[]>()
  private clock: AutomationRuntimeConfig['clock']

  constructor(config: AutomationRuntimeConfig) {
    this.store = new InMemoryRuleStore(config.rules || [])
    this.executor =
      config.executor ||
      ({
        async sendMessage() {
          throw new Error('No automation executor configured')
        },
        async invokeFlow() {},
        async escalate() {},
      } satisfies AutomationActionExecutor)
    this.clock = config.clock
    this.bootstrapSchedules()
  }

  listRules() {
    return this.store.list()
  }

  async handleMessageReceived(context: AutomationEventContext) {
    await this.evaluate('message', context)
    this.armInactivityTimers(context.sessionId)
  }

  async handleTimerFire(context: AutomationEventContext) {
    await this.evaluate('timer', context)
  }

  shutdown() {
    this.inactivityTimers.forEach((t) => (this.clock?.clearTimeout || clearTimeout)(t))
    this.scheduledTimers.forEach((t) => (this.clock?.clearTimeout || clearTimeout)(t))
    this.inactivityTimers.clear()
    this.scheduledTimers = []
  }

  private bootstrapSchedules() {
    for (const rule of this.store.list()) {
      const schedule = rule.triggers.find((t) => t.type === 'scheduled') as Extract<AutomationTrigger, { type: 'scheduled' }> | undefined
      if (!schedule || rule.enabled === false) continue
      const intervalMs = schedule.intervalMs ?? 60_000
      const startDelay = Math.max(0, (schedule.startAt ?? now(this.clock)) - now(this.clock))
      const timer = (this.clock?.setTimeout || setTimeout)(() => {
        const handle = setInterval(() => {
          void this.evaluate('schedule', { sessionId: 'broadcast', source: 'schedule' })
        }, intervalMs)
        this.scheduledTimers.push(handle as unknown as NodeJS.Timeout)
      }, startDelay)
      this.scheduledTimers.push(timer as unknown as NodeJS.Timeout)
    }
  }

  private armInactivityTimers(sessionId: string) {
    const trigger = this.store
      .list()
      .map((r) => r.triggers.find((t) => t.type === 'inactivity') as Extract<AutomationTrigger, { type: 'inactivity' }> | undefined)
      .find(Boolean)
    if (!trigger) return
    const existing = this.inactivityTimers.get(sessionId)
    if (existing) (this.clock?.clearTimeout || clearTimeout)(existing)
    const handle = (this.clock?.setTimeout || setTimeout)(() => {
      void this.evaluate('timer', { sessionId, source: 'timer' })
    }, trigger.inactivityMs)
    this.inactivityTimers.set(sessionId, handle as unknown as NodeJS.Timeout)
  }

  private async evaluate(source: AutomationEventContext['source'], context: AutomationEventContext) {
    for (const rule of this.store.list()) {
      if (rule.enabled === false) continue
      if (!this.isEligible(rule, context)) continue
      if (!this.applyDebounce(rule)) continue
      if (!this.applyRateLimit(rule)) continue
      await this.runActions(rule, context)
    }
  }

  private isEligible(rule: AutomationRule, context: AutomationEventContext): boolean {
    if (!rule.triggers.length) return false
    return rule.triggers.some((trigger) => {
      switch (trigger.type) {
        case 'keyword': {
          const text = (context.text || '').toLowerCase()
          const matches = trigger.keywords.filter((kw) => text.includes(kw.toLowerCase()))
          return trigger.match === 'all' ? matches.length === trigger.keywords.length : matches.length > 0
        }
        case 'inactivity':
          return context.source === 'timer'
        case 'scheduled':
          return context.source === 'schedule'
        case 'page_metadata': {
          const meta = context.metadata || {}
          if (trigger.path && meta.path && !String(meta.path).startsWith(trigger.path)) return false
          if (trigger.tags && trigger.tags.length) {
            const tags = Array.isArray(meta.tags) ? meta.tags.map((t: any) => String(t)) : []
            const found = trigger.tags.some((t) => tags.includes(t))
            if (!found) return false
          }
          if (trigger.attributes) {
            return Object.entries(trigger.attributes).every(([k, v]) => meta[k] === v)
          }
          return true
        }
        default:
          return false
      }
    })
  }

  private applyDebounce(rule: AutomationRule) {
    if (!rule.debounceMs) return true
    const last = this.lastFired.get(rule.id) || 0
    const delta = now(this.clock) - last
    if (delta < rule.debounceMs) return false
    this.lastFired.set(rule.id, now(this.clock))
    return true
  }

  private applyRateLimit(rule: AutomationRule) {
    if (!rule.rateLimit) return true
    const window = this.rateWindows.get(rule.id) || []
    const cutoff = now(this.clock) - rule.rateLimit.windowMs
    const filtered = window.filter((ts) => ts >= cutoff)
    if (filtered.length >= rule.rateLimit.max) {
      this.rateWindows.set(rule.id, filtered)
      return false
    }
    filtered.push(now(this.clock))
    this.rateWindows.set(rule.id, filtered)
    return true
  }

  private async runActions(rule: AutomationRule, context: AutomationEventContext) {
    for (const action of rule.actions) {
      switch (action.type) {
        case 'send_message':
          await this.executor.sendMessage(context.sessionId, action)
          break
        case 'invoke_flow':
          await this.executor.invokeFlow(context.sessionId, action)
          break
        case 'escalate':
          await this.executor.escalate(context.sessionId, action, context)
          break
        default:
          break
      }
    }
  }
}

export function buildAutomationRule(partial: Partial<AutomationRule>): AutomationRule {
  return {
    id: partial.id || uuidv4(),
    name: partial.name || 'automation-rule',
    triggers: partial.triggers || [],
    actions: partial.actions || [],
    enabled: partial.enabled ?? true,
    description: partial.description,
    debounceMs: partial.debounceMs,
    rateLimit: partial.rateLimit,
  }
}
