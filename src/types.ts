/**
 * Atelier - Type Definitions
 */

export type TaskType = 'parallel' | 'singleton'
export type InitMode = 'lazy' | 'eager'
export type CrashPolicy = 'restart-fail-in-flight' | 'restart-requeue-in-flight' | 'fail-task'

export interface TaskConfig {
  type: TaskType
  worker: () => Worker
  init?: InitMode
  poolSize?: number // Only for parallel tasks
  // Optional key derivation for cancellation scoping.
  // biome-ignore lint/suspicious/noExplicitAny: keyOf accepts arbitrary task method arguments
  keyOf?: (...args: any[]) => string
  // Optional per-call timeout (ms) that aborts the dispatch.
  timeoutMs?: number
  // Crash recovery policy for worker failures.
  crashPolicy?: CrashPolicy
  // Max consecutive crashes before escalating to fail-task.
  crashMaxRetries?: number
  // Optional label and stable ID for telemetry/UI.
  taskName?: string
  taskId?: string
  // Optional telemetry sink for dev/debug observability.
  telemetry?: TelemetrySink
  // Maximum number of in-flight calls dispatched to workers.
  // Defaults: poolSize for parallel, 1 for singleton.
  maxInFlight?: number
  // Maximum number of queued (pending) calls waiting to be dispatched.
  // Defaults to Infinity.
  maxQueueDepth?: number
  // Queue policy when maxQueueDepth is reached.
  // - block: wait for capacity
  // - reject: reject immediately
  // - drop-latest: reject newest
  // - drop-oldest: reject oldest pending entry, accept new
  queuePolicy?: QueuePolicy
  // Optional idle timeout (ms) after which workers are stopped if the queue is idle.
  idleTimeoutMs?: number
}

export interface WorkerState {
  type: TaskType
  /** Total workers configured (pool size for parallel, 1 for singleton). */
  totalWorkers?: number
  /** Workers currently initialized (created). */
  activeWorkers?: number
  /** Worker lifecycle state. */
  workerStatus?: 'running' | 'stopped' | 'stopping' | 'crashed'
  /** Most recent worker crash metadata, if any. */
  lastCrash?: { ts: number; error?: unknown; workerIndex?: number }
  /** Task lifecycle state derived from queue + pause state. */
  taskStatus?: 'idle' | 'active' | 'paused'
  /** Total number of dispatch calls made to this task since creation. */
  totalDispatched: number
  /** Pool size (parallel tasks only). */
  poolSize?: number
  /** In-flight calls (dispatched but not yet resolved/rejected). */
  queueDepth?: number
  /** Pending calls waiting in the executor queue. */
  pendingQueueDepth?: number
  /** Calls blocked waiting for queue capacity (block policy only). */
  blockedQueueDepth?: number
  /** Maximum in-flight calls allowed. */
  maxInFlight?: number
  /** Maximum pending queue depth allowed. */
  maxQueueDepth?: number
  /** Active queue policy. */
  queuePolicy?: QueuePolicy
  /** In-flight calls per worker index (parallel tasks only). */
  queueDepthByWorker?: number[]
}

export interface TaskExecutor {
  // biome-ignore lint/suspicious/noExplicitAny: Generic task dispatch returns arbitrary worker method results
  dispatch(method: string, args: unknown[], options?: TaskDispatchOptions): Promise<any>
  getState(): WorkerState
  startWorkers(): void
  stopWorkers(): void
  dispose(): void
}

export type TaskDispatchOptions = {
  key?: string
  signal?: AbortSignal
  /**
   * Transferable objects to transfer (zero-copy) instead of cloning.
   *
   * - undefined (default): Auto-detect using transferables library
   * - []: Explicitly disable transfer (clone everything)
   * - [buffer1, buffer2, ...]: Explicit list of transferables
   *
   * When transferring, the original object becomes "neutered" (unusable).
   * Use `task.with({ transfer: [...] })` to apply per-call transfer options.
   */
  transfer?: Transferable[]
  /**
   * Whether to transfer the result back from worker to main thread.
   *
   * - true (default): Transfer result (zero-copy, worker loses result)
   * - false: Clone result (worker keeps copy)
   *
   * Apply via `task.with({ transferResult: false })`.
   */
  transferResult?: boolean
}

// Minimal event set to power lightweight observability.
export type TaskEventType =
  | 'blocked'
  | 'queued'
  | 'dispatch'
  | 'success'
  | 'error'
  | 'rejected'
  | 'canceled'
  | 'worker:spawn'
  | 'worker:crash'
  | 'worker:terminate'

export type TaskEvent = {
  type: TaskEventType
  taskId: string
  taskName?: string
  workerIndex?: number
  /** Milliseconds since epoch. */
  ts: number
  /** Duration of the task call, when applicable. */
  durationMs?: number
  /** Time spent waiting in queue before dispatch, if any. */
  queueWaitMs?: number
  /** Current pending queue depth, if applicable. */
  queueDepth?: number
  /** Max pending queue depth, if applicable. */
  queueLimit?: number
  /** Current blocked queue depth, if applicable. */
  blockedDepth?: number
  /** Phase of cancellation, when applicable. */
  canceledPhase?: 'queued' | 'blocked' | 'in-flight'
  /** Original error object, if any. */
  error?: unknown
}

export type QueuePolicy = 'block' | 'reject' | 'drop-latest' | 'drop-oldest'

export type TelemetrySink = (event: TaskEvent) => void
