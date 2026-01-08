/**
 * Atelier - Core exports
 */

export { createTaskRuntime } from './runtime'
export { WorkerPool } from './worker-pool'
export { SingletonWorker } from './singleton-worker'
export { DispatchQueue } from './dispatch-queue'
export { createTaskWorker } from './task-worker'
export { WorkerCrashedError } from './worker-crash-error'
export {
  parallelLimit,
  yieldAsCompleted,
  type ParallelLimitErrorPolicy,
  type ParallelLimitOptions,
  type ParallelLimitResult,
  type ParallelLimitSettledOptions,
} from './parallel-limit'
export {
  createTelemetryStore,
  type TelemetrySnapshot,
  type TelemetryStore,
  type TelemetryStoreOptions,
  type TaskTelemetrySnapshot,
} from './telemetry'
export type {
  RuntimeSnapshot,
  RuntimeSnapshotSubscriptionOptions,
  RuntimeTaskSnapshot,
  TaskRuntime,
} from './runtime'
export type {
  AbortKey,
  AbortTaskController,
} from './abort-task-controller'
export type {
  CrashPolicy,
  TaskConfig,
  TaskEvent,
  TaskEventType,
  TaskType,
  InitMode,
  TelemetrySink,
  WorkerState,
} from './types'
export type { Task } from './define-task'
export type { TaskContext, TaskHandlerMap, StripTaskContext } from './task-worker'
