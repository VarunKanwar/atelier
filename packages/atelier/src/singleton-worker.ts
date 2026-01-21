/**
 * SingletonWorker - Manages a single worker for bottlenecked tasks
 * All requests queue at this single worker instance
 */

import { type Remote, transfer, wrap } from 'comlink'
import { getTransferables } from 'transferables'
import { DispatchQueue, type DispatchQueueState } from './dispatch-queue'
import {
  classifyErrorKind,
  createNoopObservabilityContext,
  isAbortError,
  stringifyError,
} from './observability-utils'
import type {
  CrashPolicy,
  InitMode,
  MetricEvent,
  ObservabilityContext,
  QueuePolicy,
  SpanErrorKind,
  SpanStatus,
  TaskDispatchOptions,
  TaskExecutor,
  TraceContext,
  WorkerState,
} from './types'
import { WorkerCrashedError } from './worker-crash-error'

type WorkerCall = {
  callId: string
  method: string
  args: unknown[]
  key?: string
  transfer?: Transferable[]
  transferResult?: boolean
  trace?: TraceContext
  span?: SpanRecord
}

type SpanRecord = {
  spanId: string
  callId: string
  trace?: TraceContext
  method: string
  startTime: number
  queueWaitMs: number
  queueWaitLastMs?: number
  attemptCount: number
  workerIndex?: number
  ended: boolean
  sampled: boolean
}

/**
 * SingletonWorker
 *
 * Motivation:
 * - Keep heavyweight or resource-constrained workloads (e.g. GPU models) serialized.
 *
 * Design:
 * - One worker instance, backed by a DispatchQueue.
 * - Defaults to `maxInFlight = 1` to serialize calls.
 *
 * Usage:
 * - Constructed via `runtime.defineTask({ type: 'singleton', ... })`.
 * - Configure limits with `maxInFlight` and `maxQueueDepth`.
 */
/** @internal */
// biome-ignore lint/suspicious/noExplicitAny: Generic default allows untyped singleton workers
export class SingletonWorker<T = any> implements TaskExecutor {
  private worker: Remote<T> | null = null
  private workerInstance: Worker | null = null
  private dispatchCount = 0
  private callIdCounter = 0
  private workerStatus: 'running' | 'stopped' | 'stopping' | 'crashed' = 'stopped'
  private manualPaused = false
  private idleTimeoutMs?: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly createWorker: () => Worker
  private readonly initMode: InitMode
  private readonly observability: ObservabilityContext
  private readonly taskId: string
  private readonly taskName?: string
  private readonly queue: DispatchQueue<WorkerCall>
  private readonly maxInFlight: number
  private readonly maxQueueDepth: number
  private readonly queuePolicy: QueuePolicy
  private readonly taskAttrs: Record<string, string | number>
  private readonly queueAttrs: Record<string, string | number>
  private readonly crashPolicy: CrashPolicy
  private readonly crashMaxRetries: number
  private crashCount = 0
  private crashBackoffMs = 0
  private lastCrash?: { ts: number; error?: unknown; workerIndex?: number }
  private workerTerminating = false
  private crashHandler: ((event: ErrorEvent | MessageEvent) => void) | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartWaiters: Array<() => void> = []
  private halted = false
  private haltedError: Error | null = null
  private crashed = false

  constructor(
    createWorker: () => Worker,
    initMode: InitMode = 'lazy',
    observability?: ObservabilityContext,
    taskId: string = `task-${Math.random().toString(36).slice(2)}`,
    taskName?: string,
    maxInFlight: number = 1,
    maxQueueDepth: number = 2,
    queuePolicy: QueuePolicy = 'block',
    crashPolicy: CrashPolicy = 'restart-fail-in-flight',
    crashMaxRetries: number = 3,
    idleTimeoutMs?: number
  ) {
    this.createWorker = createWorker
    this.initMode = initMode
    this.observability = observability ?? createNoopObservabilityContext()
    this.taskId = taskId
    this.taskName = taskName
    this.idleTimeoutMs = idleTimeoutMs
    this.crashPolicy = crashPolicy
    this.crashMaxRetries = crashMaxRetries
    this.maxInFlight = maxInFlight
    this.maxQueueDepth = maxQueueDepth
    this.queuePolicy = queuePolicy
    this.taskAttrs = {
      'task.id': this.taskId,
      'task.type': 'singleton',
      ...(this.taskName ? { 'task.name': this.taskName } : {}),
    }
    this.queueAttrs = {
      ...this.taskAttrs,
      'queue.policy': this.queuePolicy,
      'queue.max_in_flight': this.maxInFlight,
      'queue.max_depth': this.maxQueueDepth,
    }

    this.queue = new DispatchQueue<WorkerCall>(
      (payload, queueWaitMs) => this.dispatchToWorker(payload, queueWaitMs),
      { maxInFlight, maxQueueDepth, queuePolicy },
      {
        onStateChange: state => {
          this.emitQueueGauges(state)
        },
        onDispatch: (payload, queueWaitMs) => {
          this.onDispatchAttempt(payload, queueWaitMs)
        },
        onReject: (payload, error) => {
          this.emitMetric('counter', 'task.rejected.total', 1, this.queueAttrs)
          this.endSpan(payload.span, 'error', 'queue', error)
        },
        onCancel: (payload, phase) => {
          this.endSpan(payload.span, 'canceled', 'abort')
          if (phase === 'in-flight') {
            this.cancelInFlightCall(payload.callId)
          }
        },
        onIdle: () => {
          this.scheduleIdleStop()
        },
        onActive: () => {
          this.clearIdleTimer()
        },
      }
    )

    // Eagerly create worker if requested
    if (initMode === 'eager') {
      this.initializeWorker()
    }
  }

  private emitMetric(
    kind: MetricEvent['kind'],
    name: string,
    value: number,
    attrs?: Record<string, string | number>
  ): void {
    this.observability.emitEvent({ kind, name, value, ts: Date.now(), attrs })
  }

  private emitQueueGauges(state?: DispatchQueueState): void {
    const snapshot = state ?? this.queue.getState()
    this.emitMetric('gauge', 'queue.in_flight', snapshot.inFlight, this.queueAttrs)
    this.emitMetric('gauge', 'queue.pending', snapshot.pending, this.queueAttrs)
    this.emitMetric('gauge', 'queue.waiting', snapshot.waiting, this.queueAttrs)
  }

  private emitWorkersActive(): void {
    const activeWorkers = this.worker ? 1 : 0
    this.emitMetric('gauge', 'workers.active', activeWorkers, this.taskAttrs)
  }

  private getWorkerAttrs(workerIndex: number): Record<string, string | number> {
    return { ...this.taskAttrs, 'worker.index': workerIndex }
  }

  private createSpan(callId: string, method: string, trace?: TraceContext): SpanRecord {
    return {
      spanId: callId,
      callId,
      trace,
      method,
      startTime: this.observability.now(),
      queueWaitMs: 0,
      attemptCount: 0,
      ended: false,
      sampled: this.observability.shouldSampleSpan(trace, callId),
    }
  }

  private onDispatchAttempt(payload: WorkerCall, queueWaitMs: number): void {
    const span = payload.span
    if (span && !span.ended) {
      span.attemptCount += 1
      span.queueWaitMs += queueWaitMs
      span.queueWaitLastMs = queueWaitMs
    }
    this.emitMetric('counter', 'task.dispatch.total', 1, this.taskAttrs)
    this.emitMetric('histogram', 'queue.wait_ms', queueWaitMs, this.queueAttrs)
  }

  private endSpan(
    span: SpanRecord | undefined,
    status: SpanStatus,
    errorKind?: SpanErrorKind,
    error?: unknown
  ): void {
    if (!span || span.ended) return
    span.ended = true
    const endTime = this.observability.now()
    const durationMs = endTime - span.startTime

    if (span.attemptCount === 0 && span.queueWaitMs === 0) {
      const wait = durationMs
      span.queueWaitMs = wait
      span.queueWaitLastMs = wait
    }

    if (status === 'ok') {
      this.emitMetric('counter', 'task.success.total', 1, this.taskAttrs)
    } else if (status === 'canceled') {
      this.emitMetric('counter', 'task.canceled.total', 1, this.taskAttrs)
    } else if (status === 'error' && errorKind !== 'queue') {
      this.emitMetric('counter', 'task.failure.total', 1, this.taskAttrs)
    }

    this.emitMetric('histogram', 'task.duration_ms', durationMs, this.taskAttrs)

    if (!span.sampled || !this.observability.spansEnabled) return

    const resolvedErrorKind = errorKind ?? (error ? classifyErrorKind(error) : undefined)
    const errorMessage = error ? stringifyError(error) : undefined

    this.observability.emitMeasure('atelier:span', span.startTime, endTime, {
      spanId: span.spanId,
      traceId: span.trace?.id,
      traceName: span.trace?.name,
      callId: span.callId,
      taskId: this.taskId,
      taskName: this.taskName,
      taskType: 'singleton',
      method: span.method,
      workerIndex: span.workerIndex,
      queueWaitMs: span.queueWaitMs,
      queueWaitLastMs: span.queueWaitLastMs,
      attemptCount: span.attemptCount,
      status,
      errorKind: resolvedErrorKind,
      error: errorMessage,
    })

    this.observability.emitEvent({
      kind: 'span',
      name: 'atelier:span',
      ts: Date.now(),
      spanId: span.spanId,
      traceId: span.trace?.id,
      traceName: span.trace?.name,
      callId: span.callId,
      taskId: this.taskId,
      taskName: this.taskName,
      taskType: 'singleton',
      method: span.method,
      workerIndex: span.workerIndex,
      queueWaitMs: span.queueWaitMs,
      queueWaitLastMs: span.queueWaitLastMs,
      attemptCount: span.attemptCount,
      durationMs,
      status,
      errorKind: resolvedErrorKind,
      error: errorMessage,
    })
  }

  private initializeWorker(): void {
    if (!this.worker) {
      const workerInstance = this.createWorker()
      this.workerInstance = workerInstance
      this.worker = wrap<T>(workerInstance)
      this.workerTerminating = false
      this.attachCrashListeners(workerInstance)
      this.crashed = false
      this.workerStatus = 'running'
      this.emitMetric('counter', 'worker.spawn.total', 1, this.getWorkerAttrs(0))
      this.emitWorkersActive()
    }
  }

  private ensureWorker(): Remote<T> {
    if (!this.worker) {
      this.initializeWorker()
    }
    // biome-ignore lint/style/noNonNullAssertion: initializeWorker() guarantees worker is initialized
    return this.worker!
  }

  private attachCrashListeners(workerInstance: Worker): void {
    const handler = (event: ErrorEvent | MessageEvent) => {
      this.handleWorkerCrash(event)
    }
    this.crashHandler = handler
    workerInstance.addEventListener('error', handler)
    workerInstance.addEventListener('messageerror', handler)
  }

  private detachCrashListeners(): void {
    if (this.workerInstance && this.crashHandler) {
      this.workerInstance.removeEventListener('error', this.crashHandler)
      this.workerInstance.removeEventListener('messageerror', this.crashHandler)
    }
    this.crashHandler = null
  }

  private getCrashCause(event: ErrorEvent | MessageEvent): unknown {
    if ('error' in event && event.error !== undefined) {
      return event.error
    }
    if ('data' in event) {
      return event.data
    }
    return event
  }

  private resetCrashTracking(): void {
    this.crashCount = 0
    this.crashBackoffMs = 0
  }

  private nextCrashBackoffMs(): number {
    if (this.crashBackoffMs <= 0) {
      this.crashBackoffMs = 100
      return this.crashBackoffMs
    }
    this.crashBackoffMs = Math.min(this.crashBackoffMs * 2, 2000)
    return this.crashBackoffMs
  }

  private resolveRestartWaiters(): void {
    if (this.restartWaiters.length === 0) return
    const waiters = this.restartWaiters.splice(0, this.restartWaiters.length)
    for (const resolve of waiters) {
      resolve()
    }
  }

  private async waitForRestart(): Promise<void> {
    if (!this.restartTimer) return
    await new Promise<void>(resolve => {
      this.restartWaiters.push(resolve)
    })
  }

  private scheduleRestart(): void {
    if (this.disposed || this.manualPaused || this.halted) return
    if (this.restartTimer) return
    // Apply a small internal backoff to avoid tight crash loops.
    const delay = this.nextCrashBackoffMs()
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.disposed || this.manualPaused || this.halted) {
        this.resolveRestartWaiters()
        return
      }
      this.initializeWorker()
      this.resolveRestartWaiters()
    }, delay)
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.resolveRestartWaiters()
  }

  private handleWorkerCrash(event: ErrorEvent | MessageEvent): void {
    if (this.disposed) return
    if (this.workerTerminating) return
    if (this.crashed) return

    const cause = this.getCrashCause(event)
    this.crashed = true
    this.lastCrash = { ts: Date.now(), error: cause, workerIndex: 0 }
    this.workerStatus = 'crashed'

    this.emitMetric('counter', 'worker.crash.total', 1, this.getWorkerAttrs(0))
    this.emitWorkersActive()

    this.detachCrashListeners()
    if (this.worker) {
      // biome-ignore lint/suspicious/noExplicitAny: Comlink's releaseProxy is not in public types
      ;(this.worker as any)[Symbol.for('comlink.releaseProxy')]?.()
    }
    if (this.workerInstance) {
      this.workerInstance.terminate()
    }
    this.worker = null
    this.workerInstance = null

    const crashError = new WorkerCrashedError(this.taskId, 0, cause)
    this.crashCount += 1
    const exceeded = this.crashPolicy !== 'fail-task' && this.crashCount > this.crashMaxRetries
    const effectivePolicy = exceeded ? 'fail-task' : this.crashPolicy

    if (effectivePolicy === 'restart-fail-in-flight') {
      // Settle in-flight calls for the crashed worker to avoid deadlocks.
      const rejected = this.queue.rejectInFlight(() => true, crashError)
      if (rejected.length > 0) {
        for (const payload of rejected) {
          this.endSpan(payload.span, 'error', 'crash', crashError)
        }
      }
      this.scheduleRestart()
      return
    }

    if (effectivePolicy === 'restart-requeue-in-flight') {
      // Requeue in-flight work so it can be retried on a fresh worker.
      const requeued = this.queue.requeueInFlight(() => true)
      if (requeued.length > 0) {
        this.emitMetric('counter', 'task.requeue.total', requeued.length, this.taskAttrs)
      }
      this.scheduleRestart()
      return
    }

    this.haltTask(crashError)
  }

  private haltTask(error: Error): void {
    this.halted = true
    this.haltedError = error
    const rejected = this.queue.rejectAll(error)
    const errorKind = classifyErrorKind(error)
    for (const payload of [...rejected.pending, ...rejected.waiting, ...rejected.inFlight]) {
      this.endSpan(payload.span, 'error', errorKind, error)
    }
    this.queue.pause()
    this.terminateWorker()
  }

  private async dispatchToWorker(payload: WorkerCall, _queueWaitMs: number): Promise<unknown> {
    if (this.halted) {
      throw this.haltedError ?? new Error('Task is halted after worker crash')
    }

    if (!this.worker && this.restartTimer) {
      // Worker is backing off after a crash; wait before restarting.
      await this.waitForRestart()
      if (this.halted || this.disposed || this.manualPaused) {
        throw this.haltedError ?? new Error('Task is halted after worker crash')
      }
    }

    const worker = this.ensureWorker()

    this.dispatchCount++

    // biome-ignore lint/suspicious/noExplicitAny: __dispatch is our custom harness method, not in Comlink types
    const workerDispatch = (worker as any).__dispatch
    if (typeof workerDispatch !== 'function') {
      throw new Error('Worker does not expose __dispatch (atelier harness missing)')
    }

    // Auto-detect or use explicit transferables for arguments
    const argTransferables =
      payload.transfer !== undefined ? payload.transfer : getTransferables(payload.args)
    const argsToSend =
      argTransferables.length > 0 ? transfer(payload.args, argTransferables) : payload.args

    if (payload.span && !payload.span.ended) {
      payload.span.workerIndex = 0
    }

    try {
      const result = await workerDispatch(payload.callId, payload.method, argsToSend, payload.key)
      this.endSpan(payload.span, 'ok')
      this.resetCrashTracking()

      // Auto-detect or skip transferables for result
      const shouldTransferResult = payload.transferResult ?? true
      if (shouldTransferResult && result != null) {
        const resultTransferables = getTransferables(result)
        if (resultTransferables.length > 0) {
          return transfer(result, resultTransferables)
        }
      }
      return result
    } catch (error) {
      if (isAbortError(error)) {
        this.endSpan(payload.span, 'canceled', 'abort', error)
      } else {
        this.endSpan(payload.span, 'error', classifyErrorKind(error), error)
      }
      throw error
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Generic task dispatch returns arbitrary worker method results
  async dispatch(method: string, args: unknown[], options?: TaskDispatchOptions): Promise<any> {
    if (this.halted) {
      return Promise.reject(this.haltedError ?? new Error('Task is halted after worker crash'))
    }
    const callId = `${this.taskId}-${this.callIdCounter++}`
    const span = this.createSpan(callId, method, options?.trace)
    return this.queue.enqueue(
      {
        callId,
        method,
        args,
        key: options?.key,
        transfer: options?.transfer,
        transferResult: options?.transferResult,
        trace: options?.trace,
        span,
      },
      options
    )
  }

  getState(): WorkerState {
    const queueState = this.queue.getState()
    const workerStatus = this.crashed ? 'crashed' : this.workerStatus
    const taskStatus = this.manualPaused
      ? 'paused'
      : queueState.inFlight + queueState.pending + queueState.waiting > 0
        ? 'active'
        : 'idle'
    return {
      type: 'singleton',
      totalWorkers: 1,
      activeWorkers: this.worker ? 1 : 0,
      totalDispatched: this.dispatchCount,
      workerStatus,
      taskStatus,
      queueDepth: queueState.inFlight,
      pendingQueueDepth: queueState.pending,
      waitingQueueDepth: queueState.waiting,
      maxInFlight: queueState.maxInFlight,
      maxQueueDepth: queueState.maxQueueDepth,
      queuePolicy: queueState.queuePolicy,
      lastCrash: this.lastCrash,
    }
  }

  startWorkers(): void {
    if (this.disposed) return
    if (this.halted) {
      this.halted = false
      this.haltedError = null
      this.crashed = false
      this.resetCrashTracking()
    }
    this.manualPaused = false
    this.queue.resume()
    if (this.initMode === 'eager' && this.workerStatus === 'stopped') {
      this.initializeWorker()
    }
  }

  stopWorkers(): void {
    if (this.disposed) return
    this.manualPaused = true
    this.clearIdleTimer()
    this.queue.pause()
    this.queue.requeueInFlight()
    this.clearRestartTimer()
    this.resetCrashTracking()
    this.crashed = false
    this.terminateWorker()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.manualPaused = false
    this.clearIdleTimer()
    this.clearRestartTimer()
    this.resetCrashTracking()
    this.crashed = false
    this.queue.dispose()
    this.terminateWorker()
  }

  private terminateWorker(): void {
    if (this.workerStatus === 'stopping') return
    this.workerStatus = 'stopping'
    this.workerTerminating = true
    this.detachCrashListeners()
    if (this.worker) {
      // Comlink proxies have a special [releaseProxy] method
      // biome-ignore lint/suspicious/noExplicitAny: Comlink's releaseProxy is not in public types
      ;(this.worker as any)[Symbol.for('comlink.releaseProxy')]?.()
      this.worker = null
    }
    if (this.workerInstance) {
      this.workerInstance.terminate()
      this.workerInstance = null
      this.emitMetric('counter', 'worker.terminate.total', 1, this.getWorkerAttrs(0))
    }
    this.workerStatus = 'stopped'
    this.emitWorkersActive()
  }

  private scheduleIdleStop(): void {
    if (!this.idleTimeoutMs || this.manualPaused || this.disposed) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (this.disposed || this.manualPaused) return
      if (!this.queue.isIdle()) return
      this.resetCrashTracking()
      this.crashed = false
      this.terminateWorker()
    }, this.idleTimeoutMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private cancelInFlightCall(callId: string): void {
    const worker = this.worker
    if (!worker) return
    // biome-ignore lint/suspicious/noExplicitAny: __cancel is our custom harness method, not in Comlink types
    const cancel = (worker as any).__cancel
    if (typeof cancel !== 'function') return
    Promise.resolve()
      .then(() => cancel(callId))
      .catch(() => {
        // Ignore cancellation errors to avoid unhandled rejections.
      })
  }
}
