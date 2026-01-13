/**
 * Atelier - Core exports
 */

export type {
  AbortKey,
  AbortTaskController,
} from './abort-task-controller'
export type { Task } from './define-task'
export { DispatchQueue } from './dispatch-queue'
export {
  type ParallelLimitErrorPolicy,
  type ParallelLimitOptions,
  type ParallelLimitResult,
  type ParallelLimitSettledOptions,
  parallelLimit,
  yieldAsCompleted,
} from './parallel-limit'
export type {
  RuntimeSnapshot,
  RuntimeSnapshotSubscriptionOptions,
  RuntimeTaskSnapshot,
  TaskRuntime,
} from './runtime'
export { createTaskRuntime } from './runtime'
export { SingletonWorker } from './singleton-worker'
export type { StripTaskContext, TaskContext, TaskHandlerMap } from './task-worker'
export { createTaskWorker } from './task-worker'
export type {
  CrashPolicy,
  InitMode,
  MetricEvent,
  ObservabilityConfig,
  RuntimeEvent,
  SpanErrorKind,
  SpanEvent,
  SpanStatus,
  SpansConfig,
  TaskConfig,
  TaskDispatchOptions,
  TaskType,
  TraceContext,
  TraceEndOptions,
  TraceEndStatus,
  TraceEvent,
  WorkerState,
} from './types'
export { WorkerCrashedError } from './worker-crash-error'
export { WorkerPool } from './worker-pool'
