import { PluginDefinition, PluginSettingsSchema } from './types'

export function mergeSettingsSchemas(plugins: PluginDefinition[]): PluginSettingsSchema[] {
  return plugins.map((p) => p.settings)
}

export function buildTenantSettingsSnapshot(
  plugin: PluginDefinition,
  settings: Record<string, any>
): { schema: PluginSettingsSchema; values: Record<string, any> } {
  const defaults = plugin.settings.schema?.default || {}
  return { schema: plugin.settings, values: { ...defaults, ...(settings || {}) } }
}
