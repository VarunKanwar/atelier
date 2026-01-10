/**
 * SingletonWorker - Manages a single worker for bottlenecked tasks
 * All requests queue at this single worker instance
 */

import { type Remote, wrap } from 'comlink'
import { DispatchQueue } from './dispatch-queue'
import type {
  CrashPolicy,
  InitMode,
  QueuePolicy,
  TaskDispatchOptions,
  TaskExecutor,
  TelemetrySink,
  WorkerState,
} from './types'
import { WorkerCrashedError } from './worker-crash-error'

type WorkerCall = {
  callId: string
  method: string
  args: unknown[]
  key?: string
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
  private readonly telemetry?: TelemetrySink
  private readonly taskId: string
  private readonly taskName?: string
  private readonly queue: DispatchQueue<WorkerCall>
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
    telemetry?: TelemetrySink,
    taskId: string = `task-${Math.random().toString(36).slice(2)}`,
    taskName?: string,
    maxInFlight: number = 1,
    maxQueueDepth: number = Number.POSITIVE_INFINITY,
    queuePolicy: QueuePolicy = 'block',
    crashPolicy: CrashPolicy = 'restart-fail-in-flight',
    crashMaxRetries: number = 3,
    idleTimeoutMs?: number
  ) {
    this.createWorker = createWorker
    this.initMode = initMode
    this.telemetry = telemetry
    this.taskId = taskId
    this.taskName = taskName
    this.idleTimeoutMs = idleTimeoutMs
    this.crashPolicy = crashPolicy
    this.crashMaxRetries = crashMaxRetries

    this.queue = new DispatchQueue<WorkerCall>(
      (payload, queueWaitMs) => this.dispatchToWorker(payload, queueWaitMs),
      { maxInFlight, maxQueueDepth, queuePolicy },
      {
        onBlocked: (_payload, blockedDepth, maxDepth) => {
          this.telemetry?.({
            type: 'blocked',
            taskId: this.taskId,
            taskName: this.taskName,
            ts: Date.now(),
            blockedDepth,
            queueLimit: maxDepth,
          })
        },
        onQueued: (_payload, pendingDepth, maxDepth) => {
          this.telemetry?.({
            type: 'queued',
            taskId: this.taskId,
            taskName: this.taskName,
            ts: Date.now(),
            queueDepth: pendingDepth,
            queueLimit: maxDepth,
          })
        },
        onReject: (_payload, error) => {
          this.telemetry?.({
            type: 'rejected',
            taskId: this.taskId,
            taskName: this.taskName,
            ts: Date.now(),
            error,
          })
        },
        onCancel: (payload, phase) => {
          this.telemetry?.({
            type: 'canceled',
            taskId: this.taskId,
            taskName: this.taskName,
            ts: Date.now(),
            canceledPhase: phase,
          })
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

  private initializeWorker(): void {
    if (!this.worker) {
      const workerInstance = this.createWorker()
      this.workerInstance = workerInstance
      this.worker = wrap<T>(workerInstance)
      this.workerTerminating = false
      this.attachCrashListeners(workerInstance)
      this.crashed = false
      this.workerStatus = 'running'
      this.telemetry?.({
        type: 'worker:spawn',
        taskId: this.taskId,
        taskName: this.taskName,
        workerIndex: 0,
        ts: Date.now(),
      })
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

    this.telemetry?.({
      type: 'worker:crash',
      taskId: this.taskId,
      taskName: this.taskName,
      workerIndex: 0,
      ts: Date.now(),
      error: cause,
    })

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
        for (const _payload of rejected) {
          this.telemetry?.({
            type: 'error',
            taskId: this.taskId,
            taskName: this.taskName,
            workerIndex: 0,
            ts: Date.now(),
            error: crashError,
          })
        }
      }
      this.scheduleRestart()
      return
    }

    if (effectivePolicy === 'restart-requeue-in-flight') {
      // Requeue in-flight work so it can be retried on a fresh worker.
      const requeued = this.queue.requeueInFlight(() => true)
      if (requeued.length > 0) {
        for (const _payload of requeued) {
          this.telemetry?.({
            type: 'error',
            taskId: this.taskId,
            taskName: this.taskName,
            workerIndex: 0,
            ts: Date.now(),
            error: crashError,
          })
        }
      }
      this.scheduleRestart()
      return
    }

    this.haltTask(crashError)
  }

  private haltTask(error: Error): void {
    this.halted = true
    this.haltedError = error
    this.queue.rejectAll(error)
    this.queue.pause()
    this.terminateWorker()
  }

  private async dispatchToWorker(payload: WorkerCall, queueWaitMs: number): Promise<unknown> {
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

    const start = Date.now()
    this.telemetry?.({
      type: 'dispatch',
      taskId: this.taskId,
      taskName: this.taskName,
      workerIndex: 0,
      ts: start,
      queueWaitMs,
    })

    try {
      const result = await workerDispatch(payload.callId, payload.method, payload.args, payload.key)
      const durationMs = Date.now() - start
      this.telemetry?.({
        type: 'success',
        taskId: this.taskId,
        taskName: this.taskName,
        workerIndex: 0,
        ts: Date.now(),
        durationMs,
      })
      this.resetCrashTracking()
      return result
    } catch (error) {
      const durationMs = Date.now() - start
      this.telemetry?.({
        type: 'error',
        taskId: this.taskId,
        taskName: this.taskName,
        workerIndex: 0,
        ts: Date.now(),
        durationMs,
        error,
      })
      throw error
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Generic task dispatch returns arbitrary worker method results
  async dispatch(method: string, args: unknown[], options?: TaskDispatchOptions): Promise<any> {
    if (this.halted) {
      return Promise.reject(this.haltedError ?? new Error('Task is halted after worker crash'))
    }
    const callId = `${this.taskId}-${this.callIdCounter++}`
    return this.queue.enqueue(
      {
        callId,
        method,
        args,
        key: options?.key,
      },
      options
    )
  }

  getState(): WorkerState {
    const queueState = this.queue.getState()
    const workerStatus = this.crashed ? 'crashed' : this.workerStatus
    const taskStatus = this.manualPaused
      ? 'paused'
      : queueState.inFlight + queueState.pending + queueState.blocked > 0
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
      blockedQueueDepth: queueState.blocked,
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
      this.telemetry?.({
        type: 'worker:terminate',
        taskId: this.taskId,
        taskName: this.taskName,
        workerIndex: 0,
        ts: Date.now(),
      })
    }
    this.workerStatus = 'stopped'
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
