import { Box, HStack, Progress, Stack, Text } from '@chakra-ui/react'
import type { EdgeProps, NodeProps } from '@xyflow/react'
import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { useEffect, useMemo } from 'react'

import type { RuntimeSnapshot, RuntimeTaskSnapshot } from '../../../src'
import { layoutFlowGraph } from './flow-layout'
import type { FlowGraph } from './flow-types'

type TaskNodeData = { label: string; kind: string; state?: RuntimeTaskSnapshot }
type TaskNodeType = Node<TaskNodeData, 'task'>

type QueueEdgeData = { label: string; pending: number; blocked: number; maxDepth?: number }
type QueueEdgeType = Edge<QueueEdgeData, 'queue'>

export type ScenarioFlowCanvasProps = {
  graph: FlowGraph
  snapshot: RuntimeSnapshot
}

const TASK_WIDTH = 280
const TASK_HEIGHT = 190

const QueueMeter = ({ label, value, max }: { label: string; value: number; max?: number }) => {
  if (!max || !Number.isFinite(max)) {
    return (
      <HStack justify="space-between" fontSize="xs" color="gray.600">
        <Text>{label}</Text>
        <Text fontWeight="semibold" color="gray.800">
          {value} / ∞
        </Text>
      </HStack>
    )
  }

  const palette = value / Math.max(1, max) >= 0.9 ? 'orange' : 'blue'

  return (
    <Progress.Root value={value} max={max} size="sm" colorPalette={palette}>
      <HStack justify="space-between" mb={1}>
        <Progress.Label fontSize="xs" color="gray.600">
          {label}
        </Progress.Label>
        <Progress.ValueText fontSize="xs" color="gray.700">
          {value}/{max}
        </Progress.ValueText>
      </HStack>
      <Progress.Track>
        <Progress.Range />
      </Progress.Track>
    </Progress.Root>
  )
}

const ActivityBars = ({ values }: { values: number[] }) => {
  if (values.length === 0) return null
  const max = Math.max(1, ...values)
  return (
    <HStack align="flex-end" gap={1} h="24px">
      {values.map((value, index) => (
        <Box
          key={`${index}-${value}`}
          w="8px"
          h={`${Math.max(4, (value / max) * 24)}px`}
          bg={value > 0 ? 'blue.400' : 'gray.200'}
          borderRadius="sm"
        />
      ))}
    </HStack>
  )
}

const TaskNode = ({ data }: NodeProps<TaskNodeType>) => {
  const state = data.state
  const totalWorkers = state?.totalWorkers ?? 0
  const inFlight = state?.queueDepth ?? 0
  const activityValues =
    state?.queueDepthByWorker && state.queueDepthByWorker.length > 0
      ? state.queueDepthByWorker
      : totalWorkers > 0
        ? Array.from({ length: totalWorkers }, (_, index) => (index === 0 ? inFlight : 0))
        : []

  return (
    <Box
      bg="white"
      borderWidth="1px"
      borderColor="gray.200"
      rounded="lg"
      p={4}
      minW="200px"
      position="relative"
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1, border: 'none' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1, border: 'none' }}
      />
      <Stack gap={2}>
        <Stack gap={1}>
          <Text fontWeight="semibold" lineClamp={1}>
            {data.label}
          </Text>
          <Text fontSize="xs" color="gray.500">
            {data.kind}
          </Text>
        </Stack>

        <HStack justify="space-between" fontSize="xs" color="gray.600">
          <Text>Workers</Text>
          <Text fontWeight="semibold" color="gray.800">
            {state?.activeWorkers ?? 0}/{state?.totalWorkers ?? 0}
          </Text>
        </HStack>
        <HStack justify="space-between" fontSize="xs" color="gray.600">
          <Text>Policy</Text>
          <Text fontWeight="semibold" color="gray.800">
            {state?.queuePolicy ?? 'block'}
          </Text>
        </HStack>

        <Stack gap={1}>
          <HStack justify="space-between" fontSize="xs" color="gray.600">
            <Text>In flight</Text>
            <Text fontWeight="semibold" color="gray.800">
              {inFlight}
            </Text>
          </HStack>
          <ActivityBars values={activityValues} />
        </Stack>
      </Stack>
    </Box>
  )
}

const QueueLabel = ({ data }: { data: QueueEdgeData }) => {
  return (
    <Box bg="gray.50" borderWidth="1px" borderColor="gray.200" rounded="lg" p={3} minW="160px">
      <Stack gap={2}>
        <Text fontSize="xs" color="gray.500">
          {data.label}
        </Text>
        <QueueMeter label="Pending" value={data.pending} max={data.maxDepth} />
        <HStack justify="space-between" fontSize="xs" color="gray.600">
          <Text>Blocked</Text>
          <Text fontWeight="semibold" color="gray.800">
            {data.blocked}
          </Text>
        </HStack>
        <HStack justify="space-between" fontSize="xs" color="gray.600">
          <Text>Max depth</Text>
          <Text fontWeight="semibold" color="gray.800">
            {data.maxDepth ?? '∞'}
          </Text>
        </HStack>
      </Stack>
    </Box>
  )
}

const QueueEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<QueueEdgeType>) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} />
      {data ? (
        <EdgeLabelRenderer>
          <Box
            style={{
              position: 'absolute',
              transform: 'translate(-50%, -50%)',
              left: `${labelX}px`,
              top: `${labelY}px`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <QueueLabel data={data} />
          </Box>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

const nodeTypes = {
  task: TaskNode,
} as const

const edgeTypes = {
  queue: QueueEdge,
} as const

const ScenarioFlowCanvas = ({ graph, snapshot }: ScenarioFlowCanvasProps) => {
  const { initialNodes, initialEdges } = useMemo(() => {
    const { positions } = layoutFlowGraph(graph, {
      nodeWidth: TASK_WIDTH,
      nodeHeight: TASK_HEIGHT,
      nodesep: 60,
      ranksep: 200,
      rankdir: 'LR',
    })

    const nodes: Node[] = []
    const edges: Edge[] = []

    const taskState = new Map(snapshot.tasks.map(task => [task.taskId, task]))

    graph.nodes.forEach(node => {
      const pos = positions[node.id] ?? { x: 0, y: 0 }
      nodes.push({
        id: node.id,
        type: 'task',
        position: pos,
        data: { label: node.label, kind: node.kind, state: taskState.get(node.taskId) },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { width: TASK_WIDTH, height: TASK_HEIGHT },
      })
    })

    graph.edges.forEach(edge => {
      const queueTask = taskState.get(edge.to)
      edges.push({
        id: `queue-${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: 'queue',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#CBD5E0' },
        data: {
          label: edge.label ?? 'queue',
          pending: queueTask?.pendingQueueDepth ?? 0,
          blocked: queueTask?.blockedQueueDepth ?? 0,
          maxDepth: queueTask?.maxQueueDepth,
        } satisfies QueueEdgeData,
      })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [graph, snapshot])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(existing => {
      const nextById = new Map(initialNodes.map(node => [node.id, node]))
      const updated = existing
        .filter(node => nextById.has(node.id))
        .map(node => {
          const next = nextById.get(node.id)
          if (!next) return node
          return {
            ...node,
            data: next.data,
            type: next.type,
          }
        })
      for (const node of initialNodes) {
        if (!updated.find(item => item.id === node.id)) {
          updated.push(node)
        }
      }
      return updated
    })
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(existing => {
      const nextById = new Map(initialEdges.map(edge => [edge.id, edge]))
      const updated = existing
        .filter(edge => nextById.has(edge.id))
        .map(edge => {
          const next = nextById.get(edge.id)
          if (!next) return edge
          return {
            ...edge,
            data: next.data,
            type: next.type,
          }
        })
      for (const edge of initialEdges) {
        if (!updated.find(item => item.id === edge.id)) {
          updated.push(edge)
        }
      }
      return updated
    })
  }, [initialEdges, setEdges])

  return (
    <Box w="full" h="340px" borderWidth="1px" borderColor="gray.200" rounded="lg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        panOnScroll
        panOnDrag
      >
        <Background color="#E2E8F0" gap={24} />
        <Controls position="bottom-right" />
      </ReactFlow>
    </Box>
  )
}

export default ScenarioFlowCanvas
