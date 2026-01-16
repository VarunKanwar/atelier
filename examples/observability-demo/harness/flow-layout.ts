import * as dagre from 'dagre'
import type { FlowGraph } from './flow-types'

export type LayoutConfig = {
  nodeWidth: number
  nodeHeight: number
  nodesep: number
  ranksep: number
  rankdir: 'TB' | 'LR' | 'BT' | 'RL'
}

export type LayoutResult = {
  positions: Record<string, { x: number; y: number }>
}

const defaultConfig: LayoutConfig = {
  nodeWidth: 240,
  nodeHeight: 160,
  nodesep: 80,
  ranksep: 120,
  rankdir: 'TB',
}

export const layoutFlowGraph = (graph: FlowGraph, config: Partial<LayoutConfig> = {}): LayoutResult => {
  const resolved = { ...defaultConfig, ...config }

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: resolved.rankdir,
    nodesep: resolved.nodesep,
    ranksep: resolved.ranksep,
    marginx: 20,
    marginy: 20,
  })
  g.setDefaultEdgeLabel(() => ({}))

  graph.nodes.forEach(node => {
    g.setNode(node.id, { width: resolved.nodeWidth, height: resolved.nodeHeight })
  })

  graph.edges.forEach(edge => {
    g.setEdge(edge.from, edge.to)
  })

  dagre.layout(g)

  const positions: Record<string, { x: number; y: number }> = {}
  graph.nodes.forEach(node => {
    const layoutNode = g.node(node.id)
    if (!layoutNode) return
    positions[node.id] = {
      x: layoutNode.x - resolved.nodeWidth / 2,
      y: layoutNode.y - resolved.nodeHeight / 2,
    }
  })

  return { positions }
}
