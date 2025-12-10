# Plugin system

The backend exposes a schema-driven plugin system for actions, triggers, channel adapters, and AI context enrichment. Plugins are authored as isolated packages (for example `bacon-plugin-shopify`, `bacon-plugin-hubspot`, `bacon-plugin-salesforce`, `bacon-plugin-twilio-whatsapp`, and `bacon-plugin-zapier`). Each package exports a `PluginDefinition` that declares:

- **Settings schema:** JSON Schema object for Admin UI rendering. Defaults live in the schema `default` field; required keys and formats are validated with AJV at load time.
- **Actions & triggers:** Async functions that implement business logic. Actions may declare retries/backoff; triggers expose `subscribe` handlers for inbound events.
- **Channel adapters:** Optional `sendMessage` + `validatePayload` hooks to bridge external messaging channels.
- **AI context enrichment:** `enrichContext` returns snippets to augment the LLM prompt/context window.

## Loader and registry

- `PluginLoader` dynamically imports plugin modules, validates schemas, supports environment/config overrides, and caches loaded modules for reuse.
- `PluginRegistry` registers plugins, wraps action execution with audit logging + retries, and supplies a secrets manager so sensitive values stay out of logs.

## Flow engine integration

Flow nodes can use `plugin_action` with `config.pluginId`, `config.actionName`, and `config.payload`. Provide a `plugins.invokeAction` runtime to the `FlowEngine` context (for example backed by `PluginRegistry`) to enable audit logging and retry-safe execution inside flows.

## Admin settings

The Admin UI can render plugin configuration forms using `settings.schema`. Persist settings per-tenant/bot alongside secrets. A "Test connection" action is recommended for every plugin (all official plugins export one) and can be executed via the registry/runtime to validate credentials safely.

## Security & isolation

- Secrets are pulled from env or injected managers and should never be logged.
- Actions execute inside a guarded runtime; errors are caught and reported without crashing the host.
- Prefer least-privilege API scopes for external systems and rotate credentials regularly.
