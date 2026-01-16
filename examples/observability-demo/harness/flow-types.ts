export type FlowNode = {
  id: string
  taskId: string
  label: string
  kind: 'parallel' | 'singleton'
}

export type FlowEdge = {
  from: string
  to: string
  label?: string
}

export type FlowGraph = {
  nodes: FlowNode[]
  edges: FlowEdge[]
  order?: string[]
}
