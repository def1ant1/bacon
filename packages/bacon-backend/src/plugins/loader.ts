import path from 'path'
import { pathToFileURL } from 'url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import {
  PluginDefinition,
  PluginLoaderOptions,
  PluginResolution,
  PluginSettingsSchema,
  SecretsManager,
} from './types'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

function normalizeModuleId(moduleId: string, baseDir?: string) {
  if (moduleId.startsWith('.') || moduleId.startsWith('/')) {
    return pathToFileURL(path.resolve(baseDir || process.cwd(), moduleId)).href
  }
  return moduleId
}

function buildSecretsManager(overrides?: SecretsManager): SecretsManager {
  const cache = new Map<string, string>()
  return {
    get(key: string) {
      const override = overrides?.get?.(key)
      if (override !== undefined) return override
      if (cache.has(key)) return cache.get(key)
      const envKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      const value = process.env[envKey]
      if (value) cache.set(key, value)
      return value
    },
    set(key: string, value: string) {
      cache.set(key, value)
      overrides?.set?.(key, value)
    },
    describe() {
      const envKeys = Object.keys(process.env).filter((k) => k.startsWith('PLUGIN_'))
      const cached = Array.from(cache.keys())
      return [...new Set([...(overrides?.describe?.() || []), ...envKeys, ...cached])]
    },
  }
}

function validateSchema(schema: PluginSettingsSchema, settings: Record<string, any>) {
  const validator = ajv.compile(schema.schema)
  const ok = validator(settings)
  if (!ok) {
    const message = validator.errors?.map((e) => `${e.instancePath || e.schemaPath}: ${e.message}`).join('; ')
    throw new Error(`Plugin settings for ${schema.id} failed validation: ${message}`)
  }
}

export class PluginLoader {
  private cache: Map<string, PluginResolution>
  private logger: PluginLoaderOptions['logger']
  private baseDir?: string
  private overrides?: PluginLoaderOptions['overrides']
  private secrets: SecretsManager

  constructor(options: PluginLoaderOptions = {}) {
    this.cache = options.cache || new Map()
    this.logger = options.logger
    this.baseDir = options.baseDir
    this.overrides = options.overrides
    this.secrets = buildSecretsManager(options.secrets)
  }

  async load(moduleId: string): Promise<PluginResolution> {
    const id = normalizeModuleId(moduleId, this.baseDir)
    if (this.cache.has(id)) return this.cache.get(id)!
    const mod = await import(/* @vite-ignore */ id)
    const definition: PluginDefinition = (mod.default || mod.plugin || mod) as PluginDefinition
    this.validate(definition)
    const resolved = this.applyOverrides(definition)
    const resolution: PluginResolution = { definition: resolved, moduleId: id }
    this.cache.set(id, resolution)
    this.logger?.info?.(`[plugins] loaded ${resolved.id} from ${moduleId}`)
    return resolution
  }

  list(): PluginResolution[] {
    return Array.from(this.cache.values())
  }

  private validate(definition: PluginDefinition) {
    if (!definition?.id || !definition.settings) throw new Error('plugin definition missing id or settings')
    validateSchema(definition.settings, definition.settings.schema?.default || {})
    if (definition.actions) {
      Object.entries(definition.actions).forEach(([name, action]) => {
        if (typeof action.execute !== 'function') {
          throw new Error(`Plugin action ${name} missing executor`)
        }
      })
    }
  }

  private applyOverrides(definition: PluginDefinition): PluginDefinition {
    const override = this.overrides?.[definition.id]
    if (!override) return definition
    const merged: PluginDefinition = {
      ...definition,
      ...override,
      settings: { ...definition.settings, ...override.settings },
      actions: { ...definition.actions, ...(override.actions || {}) },
      triggers: { ...definition.triggers, ...(override.triggers || {}) },
      channels: { ...definition.channels, ...(override.channels || {}) },
    }
    if (override.settings?.schema) {
      validateSchema(merged.settings, merged.settings.schema?.default || {})
    }
    return merged
  }

  getSecrets(): SecretsManager {
    return this.secrets
  }
}
