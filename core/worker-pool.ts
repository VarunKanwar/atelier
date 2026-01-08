/**
 * WorkerPool
 *
 * Motivation:
 * - Parallelize CPU-bound work across a fixed pool of workers.
 * - Enforce per-task backpressure so work doesn't pile up in workers.
 *
 * Design:
 * - Uses a shared DispatchQueue to cap in-flight + queued calls.
 * - Dispatches to workers in round-robin order.
 * - Emits telemetry at queue/dispatch/complete boundaries.
 *
 * Usage:
 * - Constructed via `runtime.defineTask({ type: 'parallel', ... })`.
 * - Configure limits with `maxInFlight` and `maxQueueDepth`.
 */

import { wrap, type Remote } from 'comlink'
import type {
  InitMode,
  QueuePolicy,
  TaskExecutor,
  TaskDispatchOptions,
  TelemetrySink,
  WorkerState,
  CrashPolicy,
} from './types'
import { DispatchQueue } from './dispatch-queue'
import { WorkerCrashedError } from './worker-crash-error'

type WorkerCall = {
  callId: string
  method: string
  args: unknown[]
  key?: string
}

export class WorkerPool<T = any> implements TaskExecutor {
  private workers: (Remote<T> | null)[] = []
  private workerInstances: (Worker | null)[] = []
  private nextWorkerIndex = 0
  private dispatchCount = 0
  private callIdCounter = 0
  // Per-worker in-flight counts for quick diagnostics.
  private queueDepthByWorker: number[] = []
  private callIdToWorkerIndex = new Map<string, number>()
  private workerStatus: 'running' | 'stopped' | 'stopping' | 'crashed' = 'stopped'
  private manualPaused = false
  private idleTimeoutMs?: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly poolSize: number
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
  private workerCrashHandlers: (((event: ErrorEvent | MessageEvent) => void) | null)[] = []
  private workerTerminating: boolean[] = []
  private crashedWorkerIndices = new Set<number>()
  private restartTimers: (ReturnType<typeof setTimeout> | null)[] = []
  private restartWaiters: Array<() => void> = []
  private halted = false
  private haltedError: Error | null = null

  constructor(
    createWorker: () => Worker,
    poolSize: number = navigator.hardwareConcurrency || 4,
    initMode: InitMode = 'lazy',
    telemetry?: TelemetrySink,
    taskId: string = `task-${Math.random().toString(36).slice(2)}`,
    taskName?: string,
    maxInFlight: number = poolSize,
    maxQueueDepth: number = Number.POSITIVE_INFINITY,
    queuePolicy: QueuePolicy = 'block',
    crashPolicy: CrashPolicy = 'restart-fail-in-flight',
    crashMaxRetries: number = 3,
    idleTimeoutMs?: number,
  ) {
    this.createWorker = createWorker
    this.poolSize = poolSize
    this.initMode = initMode
    this.telemetry = telemetry
    this.taskId = taskId
    this.taskName = taskName
    this.idleTimeoutMs = idleTimeoutMs
    this.crashPolicy = crashPolicy
    this.crashMaxRetries = crashMaxRetries

    // Initialize array with nulls
    this.workers = Array(poolSize).fill(null)
    this.workerInstances = Array(poolSize).fill(null)
    this.queueDepthByWorker = Array(poolSize).fill(0)
    this.workerTerminating = Array(poolSize).fill(false)
    this.workerCrashHandlers = Array(poolSize).fill(null)
    this.restartTimers = Array(poolSize).fill(null)

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
      },
    )

    // Eagerly create all workers if requested
    if (initMode === 'eager') {
      this.initializePool()
    }
  }

  private initializePool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.ensureWorker(i)
    }
    if (this.workerStatus !== 'running') {
      this.workerStatus = 'running'
    }
  }

  private ensureWorker(index: number): Remote<T> {
    if (!this.workers[index]) {
      const workerInstance = this.createWorker()
      this.workerInstances[index] = workerInstance
      this.workers[index] = wrap<T>(workerInstance)
      this.workerTerminating[index] = false
      this.attachCrashListeners(index, workerInstance)
      this.crashedWorkerIndices.delete(index)
      this.workerStatus = 'running'
      this.telemetry?.({
        type: 'worker:spawn',
        taskId: this.taskId,
        taskName: this.taskName,
        workerIndex: index,
        ts: Date.now(),
      })
    }
    return this.workers[index]!
  }

  private attachCrashListeners(index: number, workerInstance: Worker): void {
    const handler = (event: ErrorEvent | MessageEvent) => {
      this.handleWorkerCrash(index, event)
    }
    this.workerCrashHandlers[index] = handler
    workerInstance.addEventListener('error', handler)
    workerInstance.addEventListener('messageerror', handler)
  }

  private detachCrashListeners(index: number): void {
    const workerInstance = this.workerInstances[index]
    const handler = this.workerCrashHandlers[index]
    if (workerInstance && handler) {
      workerInstance.removeEventListener('error', handler)
      workerInstance.removeEventListener('messageerror', handler)
    }
    this.workerCrashHandlers[index] = null
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

  private isRestartPending(index: number): boolean {
    return this.restartTimers[index] !== null
  }

  private resolveRestartWaiters(): void {
    if (this.restartWaiters.length === 0) return
    const waiters = this.restartWaiters.splice(0, this.restartWaiters.length)
    for (const resolve of waiters) {
      resolve()
    }
  }

  private async waitForRestart(): Promise<void> {
    if (this.restartTimers.every((timer) => timer === null)) {
      return
    }
    await new Promise<void>((resolve) => {
      this.restartWaiters.push(resolve)
    })
  }

  private pickWorkerIndex(): number | null {
    for (let i = 0; i < this.poolSize; i++) {
      const index = (this.nextWorkerIndex + i) % this.poolSize
      if (this.workers[index]) {
        this.nextWorkerIndex = (index + 1) % this.poolSize
        return index
      }
      if (!this.isRestartPending(index)) {
        this.nextWorkerIndex = (index + 1) % this.poolSize
        return index
      }
    }
    return null
  }

  private scheduleWorkerRestart(index: number): void {
    if (this.disposed || this.manualPaused || this.halted) return
    if (this.restartTimers[index]) return
    // Apply a small internal backoff to avoid tight crash loops.
    const delay = this.nextCrashBackoffMs()
    this.restartTimers[index] = setTimeout(() => {
      this.restartTimers[index] = null
      if (this.disposed || this.manualPaused || this.halted) {
        this.resolveRestartWaiters()
        return
      }
      this.ensureWorker(index)
      this.resolveRestartWaiters()
    }, delay)
  }

  private clearRestartTimers(): void {
    for (let i = 0; i < this.restartTimers.length; i++) {
      const timer = this.restartTimers[i]
      if (timer) {
        clearTimeout(timer)
        this.restartTimers[i] = null
      }
    }
    this.resolveRestartWaiters()
  }

  private handleWorkerCrash(index: number, event: ErrorEvent | MessageEvent): void {
    if (this.disposed) return
    if (this.workerTerminating[index]) return
    if (this.crashedWorkerIndices.has(index)) return

    const cause = this.getCrashCause(event)
    this.crashedWorkerIndices.add(index)
    this.lastCrash = { ts: Date.now(), error: cause, workerIndex: index }
    this.workerStatus = 'crashed'

    this.telemetry?.({
      type: 'worker:crash',
      taskId: this.taskId,
      taskName: this.taskName,
      workerIndex: index,
      ts: Date.now(),
      error: cause,
    })

    // Tear down the crashed worker and proxy.
    this.detachCrashListeners(index)
    const workerProxy = this.workers[index]
    if (workerProxy) {
      ;(workerProxy as any)[Symbol.for('comlink.releaseProxy')]?.()
    }
    const workerInstance = this.workerInstances[index]
    if (workerInstance) {
      workerInstance.terminate()
    }
    this.workers[index] = null
    this.workerInstances[index] = null
    this.queueDepthByWorker[index] = 0

    const crashError = new WorkerCrashedError(this.taskId, index, cause)
    this.crashCount += 1
    const exceeded = this.crashPolicy !== 'fail-task' && this.crashCount > this.crashMaxRetries
    const effectivePolicy = exceeded ? 'fail-task' : this.crashPolicy

    if (effectivePolicy === 'restart-fail-in-flight') {
      // Settle in-flight calls for the crashed worker to avoid deadlocks.
      const rejected = this.queue.rejectInFlight(
        (payload) => this.callIdToWorkerIndex.get(payload.callId) === index,
        crashError,
      )
      if (rejected.length > 0) {
        for (const payload of rejected) {
          this.callIdToWorkerIndex.delete(payload.callId)
          this.telemetry?.({
            type: 'error',
            taskId: this.taskId,
            taskName: this.taskName,
            workerIndex: index,
            ts: Date.now(),
            error: crashError,
          })
        }
      }
      this.scheduleWorkerRestart(index)
      return
    }

    if (effectivePolicy === 'restart-requeue-in-flight') {
      // Requeue in-flight work so it can be retried on a fresh worker.
      const requeued = this.queue.requeueInFlight(
        (payload) => this.callIdToWorkerIndex.get(payload.callId) === index,
      )
      if (requeued.length > 0) {
        for (const payload of requeued) {
          this.callIdToWorkerIndex.delete(payload.callId)
          this.telemetry?.({
            type: 'error',
            taskId: this.taskId,
            taskName: this.taskName,
            workerIndex: index,
            ts: Date.now(),
            error: crashError,
          })
        }
      }
      this.scheduleWorkerRestart(index)
      return
    }

    // fail-task
    this.haltTask(crashError)
  }

  private haltTask(error: Error): void {
    this.halted = true
    this.haltedError = error
    this.queue.rejectAll(error)
    this.queue.pause()
    this.terminateWorkers()
  }

  private async dispatchToWorker(payload: WorkerCall, queueWaitMs: number): Promise<unknown> {
    if (this.halted) {
      throw this.haltedError ?? new Error('Task is halted after worker crash')
    }

    let workerIndex = this.pickWorkerIndex()
    if (workerIndex === null) {
      // All workers are either crashed or backing off; wait for a restart.
      await this.waitForRestart()
      if (this.halted || this.disposed || this.manualPaused) {
        throw this.haltedError ?? new Error('Task is halted after worker crash')
      }
      workerIndex = this.pickWorkerIndex()
      if (workerIndex === null) {
        throw new Error('No available workers')
      }
    }

    const worker = this.ensureWorker(workerIndex)

    this.dispatchCount++

    // Dispatch via worker harness to support cooperative cancellation.
    const workerDispatch = (worker as any).__dispatch
    if (typeof workerDispatch !== 'function') {
      throw new Error('Worker does not expose __dispatch (atelier harness missing)')
    }
    this.callIdToWorkerIndex.set(payload.callId, workerIndex)

    const start = Date.now()
    this.queueDepthByWorker[workerIndex] += 1
    this.telemetry?.({
      type: 'dispatch',
      taskId: this.taskId,
      taskName: this.taskName,
      workerIndex,
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
        workerIndex,
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
        workerIndex,
        ts: Date.now(),
        durationMs,
        error,
      })
      throw error
    } finally {
      this.queueDepthByWorker[workerIndex] = Math.max(
        0,
        (this.queueDepthByWorker[workerIndex] ?? 0) - 1,
      )
      this.callIdToWorkerIndex.delete(payload.callId)
    }
  }

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
      options,
    )
  }

  getState(): WorkerState {
    const activeWorkers = this.workers.filter((w) => w !== null).length
    const queueState = this.queue.getState()
    const workerStatus =
      this.crashedWorkerIndices.size > 0 ? 'crashed' : this.workerStatus
    const taskStatus =
      this.manualPaused
        ? 'paused'
        : queueState.inFlight + queueState.pending + queueState.blocked > 0
          ? 'active'
          : 'idle'

    return {
      type: 'parallel',
      poolSize: this.poolSize,
      totalWorkers: this.poolSize,
      activeWorkers,
      totalDispatched: this.dispatchCount,
      workerStatus,
      taskStatus,
      queueDepth: queueState.inFlight,
      pendingQueueDepth: queueState.pending,
      blockedQueueDepth: queueState.blocked,
      maxInFlight: queueState.maxInFlight,
      maxQueueDepth: queueState.maxQueueDepth,
      queuePolicy: queueState.queuePolicy,
      queueDepthByWorker: [...this.queueDepthByWorker],
      lastCrash: this.lastCrash,
    }
  }

  startWorkers(): void {
    if (this.disposed) return
    if (this.halted) {
      this.halted = false
      this.haltedError = null
      this.crashedWorkerIndices.clear()
      this.resetCrashTracking()
    }
    this.manualPaused = false
    this.queue.resume()
    if (this.initMode === 'eager' && this.workerStatus === 'stopped') {
      this.initializePool()
    }
  }

  stopWorkers(): void {
    if (this.disposed) return
    this.manualPaused = true
    this.clearIdleTimer()
    this.queue.pause()
    this.queue.requeueInFlight()
    this.clearRestartTimers()
    this.resetCrashTracking()
    this.crashedWorkerIndices.clear()
    this.terminateWorkers()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.manualPaused = false
    this.clearIdleTimer()
    this.clearRestartTimers()
    this.resetCrashTracking()
    this.crashedWorkerIndices.clear()
    this.queue.dispose()
    this.terminateWorkers()
  }

  private terminateWorkers(): void {
    if (this.workerStatus === 'stopping') return
    this.workerStatus = 'stopping'
    this.clearRestartTimers()
    for (let i = 0; i < this.workers.length; i++) {
      this.workerTerminating[i] = true
      this.detachCrashListeners(i)
      const workerProxy = this.workers[i]
      if (workerProxy) {
        // Comlink proxies have a special [releaseProxy] method
        ;(workerProxy as any)[Symbol.for('comlink.releaseProxy')]?.()
      }
      const workerInstance = this.workerInstances[i]
      if (workerInstance) {
        workerInstance.terminate()
        this.telemetry?.({
          type: 'worker:terminate',
          taskId: this.taskId,
          taskName: this.taskName,
          workerIndex: i,
          ts: Date.now(),
        })
      }
    }
    this.workers = []
    this.workerInstances = []
    this.queueDepthByWorker = Array(this.poolSize).fill(0)
    this.callIdToWorkerIndex.clear()
    this.workerTerminating = Array(this.poolSize).fill(false)
    this.workerStatus = 'stopped'
  }

  private scheduleIdleStop(): void {
    if (!this.idleTimeoutMs || this.manualPaused || this.disposed) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (this.disposed || this.manualPaused) return
      if (!this.queue.isIdle()) return
      this.resetCrashTracking()
      this.crashedWorkerIndices.clear()
      this.terminateWorkers()
    }, this.idleTimeoutMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private cancelInFlightCall(callId: string): void {
    const workerIndex = this.callIdToWorkerIndex.get(callId)
    if (workerIndex === undefined) return
    const worker = this.workers[workerIndex]
    if (!worker) return
    const cancel = (worker as any).__cancel
    if (typeof cancel !== 'function') return
    Promise.resolve()
      .then(() => cancel(callId))
      .catch(() => {
        // Ignore cancellation errors to avoid unhandled rejections.
      })
  }
}
