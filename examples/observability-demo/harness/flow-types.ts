export type FlowNode = {
  id: string
  taskId: string
  label: string
  kind: 'parallel' | 'singleton' | 'source' | 'sink'
}

export type FlowEdge = {
  from: string
  to: string
  label?: string
  kind?: 'queue' | 'external'
}

export type FlowGraph = {
  nodes: FlowNode[]
  edges: FlowEdge[]
  order?: string[]
}
