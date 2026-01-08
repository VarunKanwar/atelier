import type { TaskEvent, TelemetrySink } from './types'

/**
 * Telemetry store
 *
 * Motivation:
 * - Provide lightweight, in-memory observability for dev/debug.
 *
 * Design:
 * - Consumes TaskEvents and aggregates "current state" metrics.
 * - Keeps a rolling window of durations/queue waits for p50/p95.
 *
 * Usage:
 * - `const telemetry = createTelemetryStore()`
 * - Pass `telemetry.emit` into `runtime.defineTask({ telemetry: ... })`
 * - Call `telemetry.getState()` to drive UI or logging.
 */

export type TaskTelemetrySnapshot = {
  taskId: string
  taskName?: string
  /** In-flight calls (dispatched but not yet resolved/rejected). */
  inFlight: number
  /** Pending calls waiting in the executor queue. */
  pending: number
  /** Calls blocked waiting for queue capacity (block policy only). */
  blocked: number
  /** Total number of dispatch calls made since task creation. */
  totalDispatched: number
  /** Count of successful task calls. */
  success: number
  /** Count of failed task calls. */
  failure: number
  /** Count of rejected calls (queue full). */
  rejected: number
  /** Count of canceled calls (AbortSignal). */
  canceled: number
  /** Average duration across successes+failures (ms). */
  avgMs?: number
  /** Median (p50) duration across recent samples (ms). */
  p50Ms?: number
  /** p95 duration across recent samples (ms). */
  p95Ms?: number
  /** Duration of the most recent completed call (ms). */
  lastDurationMs?: number
  /** Most recent queue wait time (ms). */
  lastQueueWaitMs?: number
  /** Average queue wait time across recent samples (ms). */
  avgQueueWaitMs?: number
  /** p50 queue wait time across recent samples (ms). */
  p50QueueWaitMs?: number
  /** p95 queue wait time across recent samples (ms). */
  p95QueueWaitMs?: number
  /** Most recent error encountered (if any). */
  lastError?: unknown
  /** Most recent worker crash (if any). */
  lastCrash?: { ts: number; error?: unknown; workerIndex?: number }
  /** Count of currently active workers for this task. */
  activeWorkers: number
  /** Total number of worker spawns seen over lifetime. */
  totalWorkersSpawned: number
  /** In-flight calls per worker index. */
  inFlightByWorker: number[]
}

export type TelemetrySnapshot = {
  tasks: Record<string, TaskTelemetrySnapshot>
}

type TaskTelemetryInternal = {
  taskId: string
  taskName?: string
  inFlight: number
  pending: number
  blocked: number
  totalDispatched: number
  success: number
  failure: number
  rejected: number
  canceled: number
  totalDurationMs: number
  durations: number[]
  queueWaits: number[]
  lastDurationMs?: number
  lastQueueWaitMs?: number
  lastError?: unknown
  lastCrash?: { ts: number; error?: unknown; workerIndex?: number }
  activeWorkerIndices: Set<number>
  totalWorkersSpawned: number
  inFlightByWorker: number[]
}

export type TelemetryStore = {
  emit: TelemetrySink
  getState: () => TelemetrySnapshot
  reset: () => void
}

export type TelemetryStoreOptions = {
  maxSamples?: number
}

// Lightweight in-memory telemetry store. Designed for dev/debug panels.
export const createTelemetryStore = (options: TelemetryStoreOptions = {}): TelemetryStore => {
  const maxSamples = options.maxSamples ?? 200
  const tasks = new Map<string, TaskTelemetryInternal>()

  const ensureTask = (event: TaskEvent): TaskTelemetryInternal => {
    const existing = tasks.get(event.taskId)
    if (existing) {
      if (!existing.taskName && event.taskName) {
        existing.taskName = event.taskName
      }
      return existing
    }

    const created: TaskTelemetryInternal = {
      taskId: event.taskId,
      taskName: event.taskName,
      inFlight: 0,
      pending: 0,
      blocked: 0,
      totalDispatched: 0,
      success: 0,
      failure: 0,
      rejected: 0,
      canceled: 0,
      totalDurationMs: 0,
      durations: [],
      queueWaits: [],
      lastDurationMs: undefined,
      lastQueueWaitMs: undefined,
      lastError: undefined,
      lastCrash: undefined,
      activeWorkerIndices: new Set<number>(),
      totalWorkersSpawned: 0,
      inFlightByWorker: [],
    }
    tasks.set(event.taskId, created)
    return created
  }

  const recordDuration = (metrics: TaskTelemetryInternal, durationMs: number) => {
    metrics.totalDurationMs += durationMs
    metrics.lastDurationMs = durationMs
    metrics.durations.push(durationMs)
    if (metrics.durations.length > maxSamples) {
      metrics.durations.shift()
    }
  }

  const recordQueueWait = (metrics: TaskTelemetryInternal, queueWaitMs: number) => {
    metrics.lastQueueWaitMs = queueWaitMs
    metrics.queueWaits.push(queueWaitMs)
    if (metrics.queueWaits.length > maxSamples) {
      metrics.queueWaits.shift()
    }
  }

  const emit: TelemetrySink = (event) => {
    const metrics = ensureTask(event)
    const workerIndex = event.workerIndex ?? 0

    switch (event.type) {
      case 'blocked':
        if (event.blockedDepth !== undefined) {
          metrics.blocked = event.blockedDepth
        } else {
          metrics.blocked += 1
        }
        return
      case 'queued':
        metrics.pending += 1
        return
      case 'dispatch':
        metrics.totalDispatched += 1
        metrics.inFlight += 1
        metrics.inFlightByWorker[workerIndex] = (metrics.inFlightByWorker[workerIndex] ?? 0) + 1
        metrics.pending = Math.max(0, metrics.pending - 1)
        metrics.blocked = Math.max(0, metrics.blocked - 1)
        if (event.queueWaitMs !== undefined) {
          recordQueueWait(metrics, event.queueWaitMs)
        }
        return
      case 'success':
        metrics.inFlight = Math.max(0, metrics.inFlight - 1)
        metrics.inFlightByWorker[workerIndex] = Math.max(
          0,
          (metrics.inFlightByWorker[workerIndex] ?? 0) - 1,
        )
        metrics.success += 1
        if (event.durationMs !== undefined) {
          recordDuration(metrics, event.durationMs)
        }
        return
      case 'error':
        metrics.inFlight = Math.max(0, metrics.inFlight - 1)
        metrics.inFlightByWorker[workerIndex] = Math.max(
          0,
          (metrics.inFlightByWorker[workerIndex] ?? 0) - 1,
        )
        metrics.failure += 1
        metrics.lastError = event.error
        if (event.durationMs !== undefined) {
          recordDuration(metrics, event.durationMs)
        }
        return
      case 'rejected':
        metrics.rejected += 1
        return
      case 'canceled':
        metrics.canceled += 1
        if (event.canceledPhase === 'queued') {
          metrics.pending = Math.max(0, metrics.pending - 1)
        } else if (event.canceledPhase === 'blocked') {
          metrics.blocked = Math.max(0, metrics.blocked - 1)
        }
        return
      case 'worker:spawn':
        metrics.activeWorkerIndices.add(workerIndex)
        metrics.totalWorkersSpawned += 1
        return
      case 'worker:terminate':
        metrics.activeWorkerIndices.delete(workerIndex)
        return
      case 'worker:crash':
        metrics.lastCrash = { ts: event.ts, error: event.error, workerIndex }
        metrics.activeWorkerIndices.delete(workerIndex)
        return
      default:
        return
    }
  }

  const getState = (): TelemetrySnapshot => {
    const snapshot: TelemetrySnapshot = { tasks: {} }

    for (const metrics of tasks.values()) {
      const count = metrics.success + metrics.failure
      const avgMs = count > 0 ? metrics.totalDurationMs / count : undefined
      const { p50, p95 } = computeQuantiles(metrics.durations)
      const { p50: p50Queue, p95: p95Queue } = computeQuantiles(metrics.queueWaits)
      const avgQueueWaitMs =
        metrics.queueWaits.length > 0
          ? metrics.queueWaits.reduce((sum, value) => sum + value, 0) / metrics.queueWaits.length
          : undefined

      snapshot.tasks[metrics.taskId] = {
        taskId: metrics.taskId,
        taskName: metrics.taskName,
        inFlight: metrics.inFlight,
        pending: metrics.pending,
        blocked: metrics.blocked,
        totalDispatched: metrics.totalDispatched,
        success: metrics.success,
        failure: metrics.failure,
        rejected: metrics.rejected,
        canceled: metrics.canceled,
        avgMs,
        p50Ms: p50,
        p95Ms: p95,
        lastDurationMs: metrics.lastDurationMs,
        lastQueueWaitMs: metrics.lastQueueWaitMs,
        avgQueueWaitMs,
        p50QueueWaitMs: p50Queue,
        p95QueueWaitMs: p95Queue,
        lastError: metrics.lastError,
        lastCrash: metrics.lastCrash,
        activeWorkers: metrics.activeWorkerIndices.size,
        totalWorkersSpawned: metrics.totalWorkersSpawned,
        inFlightByWorker: [...metrics.inFlightByWorker],
      }
    }

    return snapshot
  }

  const reset = () => {
    tasks.clear()
  }

  return { emit, getState, reset }
}

const computeQuantiles = (values: number[]): { p50?: number; p95?: number } => {
  if (values.length === 0) return { p50: undefined, p95: undefined }
  const sorted = [...values].sort((a, b) => a - b)
  const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)]
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)]
  return { p50, p95 }
}
