import {
  PluginActionContext,
  PluginAuditLog,
  PluginDefinition,
  PluginRuntimeOptions,
  PluginContextEnrichment,
} from './types'

export class PluginRegistry {
  private plugins: Map<string, PluginDefinition>
  private auditSink?: (entry: PluginAuditLog) => void
  private logger?: PluginRuntimeOptions['logger']
  private secrets: PluginRuntimeOptions['secrets']

  constructor(opts: PluginRuntimeOptions = {}) {
    this.plugins = new Map()
    this.auditSink = opts.auditSink
    this.logger = opts.logger
    this.secrets = opts.secrets
  }

  register(def: PluginDefinition) {
    this.plugins.set(def.id, def)
    this.logger?.info?.(`[plugins] registered ${def.id}`)
  }

  all(): PluginDefinition[] {
    return Array.from(this.plugins.values())
  }

  get(id: string): PluginDefinition | undefined {
    return this.plugins.get(id)
  }

  async invokeAction(
    pluginId: string,
    actionName: string,
    ctx: Omit<PluginActionContext, 'audit'>,
    input: Record<string, any>
  ) {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) throw new Error(`plugin ${pluginId} not registered`)
    const action = plugin.actions?.[actionName]
    if (!action) throw new Error(`action ${actionName} missing on ${pluginId}`)
    const auditBase: PluginAuditLog = {
      pluginId,
      action: actionName,
      status: 'ok',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
    const audit = (entry: Partial<PluginAuditLog>) => {
      const event = { ...auditBase, ...entry, completedAt: new Date().toISOString() }
      this.auditSink?.(event)
    }

    const runtimeCtx: PluginActionContext = {
      ...ctx,
      secrets: this.secrets || ctx.secrets,
      audit,
      aiContext: ctx.aiContext,
    }

    const retryCfg = action.retry || { attempts: 1, backoffMs: 250 }
    let attempt = 0
    while (attempt < retryCfg.attempts) {
      try {
        const result = await action.execute(runtimeCtx, input)
        audit({ status: 'ok', meta: { attempt } })
        return result
      } catch (err: any) {
        attempt += 1
        const shouldRetry = attempt < retryCfg.attempts
        audit({ status: 'error', error: err?.message || String(err), meta: { attempt } })
        this.logger?.warn?.(`[plugins] action ${pluginId}:${actionName} failed`, err)
        if (!shouldRetry) throw err
        await new Promise((resolve) => setTimeout(resolve, retryCfg.backoffMs * attempt))
      }
    }
    throw new Error('unreachable')
  }

  async collectContext(pluginId: string, ctx: PluginActionContext): Promise<PluginContextEnrichment[]> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin?.enrichContext) return []
    try {
      const enrichments = await plugin.enrichContext(ctx)
      return enrichments || []
    } catch (err) {
      this.logger?.warn?.(`[plugins] enrichContext failed for ${pluginId}`, err)
      return []
    }
  }
}
