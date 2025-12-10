export type FlowNodeType =
  | 'start'
  | 'llm'
  | 'condition'
  | 'http_request'
  | 'delay'
  | 'escalate_to_agent'
  | 'crm_lookup'
  | 'shopify_order_lookup'
  | 'plugin_action'
  | 'end'

export interface FlowNode<TConfig = any> {
  id: string
  type: FlowNodeType
  name?: string
  description?: string
  config: TConfig
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  condition?: string
}

export interface FlowDefinition {
  id: string
  botId: string
  name: string
  description?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  version: number
  createdAt: string
  updatedAt: string
  createdBy?: string
  updatedBy?: string
}

export interface FlowTraceEntry {
  nodeId: string
  nodeType: FlowNodeType
  startedAt: string
  completedAt: string
  outcome: 'success' | 'skipped' | 'error'
  details?: any
  errorMessage?: string
}

export interface FlowExecutionResult {
  flowId: string
  version: number
  trace: FlowTraceEntry[]
  output?: any
}

export interface FlowExecutionContext {
  input: any
  vars: Record<string, any>
  botId: string
  abortSignal?: AbortSignal
  plugins?: {
    invokeAction: (
      pluginId: string,
      actionName: string,
      input: Record<string, any>
    ) => Promise<{ ok: boolean; data?: any }>
  }
}

export interface NodeExecutionResult {
  status: 'ok' | 'error' | 'skip'
  nextNodeId?: string
  data?: any
  error?: Error
}
