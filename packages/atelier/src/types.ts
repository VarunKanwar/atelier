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
  // Optional label and stable ID for observability/UI.
  taskName?: string
  taskId?: string
  // Maximum number of in-flight calls dispatched to workers.
  // Defaults: poolSize for parallel, 1 for singleton.
  maxInFlight?: number
  // Maximum number of queued (pending) calls waiting to be dispatched.
  // Defaults: parallel => maxInFlight * 2, singleton => 2.
  maxQueueDepth?: number
  // Queue policy when maxQueueDepth is reached.
  // - block: wait at the call site for capacity
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
  /** Calls waiting for queue capacity (block policy only). */
  waitingQueueDepth?: number
  /** Maximum in-flight calls allowed. */
  maxInFlight?: number
  /** Maximum pending queue depth allowed. */
  maxQueueDepth?: number
  /** Active queue policy. */
  queuePolicy?: QueuePolicy
  /** In-flight calls per worker index (parallel tasks only). */
  queueDepthByWorker?: number[]
}

/** @internal */
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
  /** Optional trace context to associate this call with a trace. */
  trace?: TraceContext
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

export type QueuePolicy = 'block' | 'reject' | 'drop-latest' | 'drop-oldest'

export type TraceEndStatus = 'ok' | 'error' | 'canceled'

/** Options passed to TraceContext.end() to record status/error details. */
export type TraceEndOptions = {
  status?: TraceEndStatus
  error?: unknown
}

/**
 * Explicit trace context. Create via runtime.createTrace() or runtime.runWithTrace().
 * Attach to calls using task.with({ trace }).
 */
export type TraceContext = {
  id: string
  name?: string
  sampled: boolean
  end: (options?: TraceEndOptions) => void
}

/** Controls span emission and sampling. */
export type SpansConfig =
  | 'auto'
  | 'on'
  | 'off'
  | {
      mode?: 'auto' | 'on' | 'off'
      sampleRate?: number
    }

/** Observability configuration for the runtime. */
export type ObservabilityConfig = {
  spans?: SpansConfig
}

/** Internal observability helpers passed to executors. */
/** @internal */
export type ObservabilityContext = {
  spansEnabled: boolean
  sampleRate: number
  now: () => number
  emitEvent: (event: RuntimeEvent) => void
  emitMeasure: (name: string, start: number, end: number, detail?: object) => void
  shouldSampleSpan: (trace: TraceContext | undefined, spanId: string) => boolean
}

/** Counter/gauge/histogram events emitted from the runtime. */
export type MetricEvent = {
  kind: 'counter' | 'gauge' | 'histogram'
  name: string
  value: number
  /** Milliseconds since epoch. */
  ts: number
  attrs?: Record<string, string | number>
}

export type SpanStatus = 'ok' | 'error' | 'canceled'
export type SpanErrorKind = 'abort' | 'queue' | 'crash' | 'exception'

/** Mirror of a span measure for reliable consumption. */
export type SpanEvent = {
  kind: 'span'
  name: 'atelier:span'
  ts: number
  spanId: string
  traceId?: string
  traceName?: string
  callId: string
  taskId: string
  taskName?: string
  taskType: TaskType
  method: string
  workerIndex?: number
  queueWaitMs?: number
  queueWaitLastMs?: number
  attemptCount: number
  durationMs?: number
  status: SpanStatus
  errorKind?: SpanErrorKind
  error?: string
}

/** Trace end event emitted when trace.end() is called. */
export type TraceEvent = {
  kind: 'trace'
  name: 'atelier:trace'
  ts: number
  traceId: string
  traceName?: string
  durationMs?: number
  status: TraceEndStatus
  errorKind?: SpanErrorKind
  error?: string
}

/** Union of all observability events emitted by the runtime. */
export type RuntimeEvent = MetricEvent | SpanEvent | TraceEvent
