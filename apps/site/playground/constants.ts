import type { CrashPolicy, QueuePolicy } from '@varunkanwar/atelier'
import type { FlowGraph } from '../harness/flow-types'

export type RunStatus = 'idle' | 'running' | 'done'
export type TabId =
  | 'overview'
  | 'throughput'
  | 'backpressure'
  | 'cancellation'
  | 'crashes'
  | 'playground'

export type TabConfig = {
  imageCount: number
  limitConcurrency: boolean
  maxConcurrent: number
  limitQueueDepth: boolean
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  crashPolicy: CrashPolicy
}

export const graph: FlowGraph = {
  nodes: [
    { id: 'source', taskId: 'source', label: 'Source', kind: 'source' },
    { id: 'resize', taskId: 'resize', label: 'Resize', kind: 'parallel' },
    { id: 'analyze', taskId: 'analyze', label: 'Analyze', kind: 'singleton' },
    { id: 'enhance', taskId: 'enhance', label: 'Enhance', kind: 'singleton' },
    { id: 'sink', taskId: 'sink', label: 'External', kind: 'sink' },
  ],
  edges: [
    { from: 'source', to: 'resize', label: 'queue' },
    { from: 'resize', to: 'analyze', label: 'queue' },
    { from: 'analyze', to: 'enhance', label: 'queue' },
    { from: 'enhance', to: 'sink', label: 'downstream', kind: 'external' },
  ],
  order: ['source', 'resize', 'analyze', 'enhance', 'sink'],
}

export const queuePolicies: { label: string; value: QueuePolicy }[] = [
  { label: 'Block (wait at call site)', value: 'block' },
  { label: 'Reject (fail immediately)', value: 'reject' },
  { label: 'Drop oldest (evict queue head)', value: 'drop-oldest' },
  { label: 'Drop latest (evict new item)', value: 'drop-latest' },
]

export const crashPolicies: { label: string; value: CrashPolicy }[] = [
  { label: 'Restart + requeue work', value: 'restart-requeue-in-flight' },
  { label: 'Restart + fail in-flight', value: 'restart-fail-in-flight' },
  { label: 'Fail task entirely', value: 'fail-task' },
]

export const TAB_DEFAULTS: Record<TabId, TabConfig> = {
  overview: {
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  throughput: {
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  backpressure: {
    imageCount: 40,
    limitConcurrency: false,
    maxConcurrent: 12,
    limitQueueDepth: true,
    maxQueueDepth: 8,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  cancellation: {
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 4,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  crashes: {
    imageCount: 24,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  playground: {
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: true,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
}
