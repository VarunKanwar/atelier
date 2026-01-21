/**
 * DispatchQueue
 *
 * Motivation:
 * - Enforce consistent queueing semantics across task types.
 * - Prevent unbounded worker backlogs and make backpressure observable.
 *
 * Design:
 * - FIFO queue in the executor with maxInFlight + maxQueueDepth limits.
 * - Queue policy controls behavior when full:
 *   - block: wait at call site for capacity (default)
 *   - reject: reject immediately
 *   - drop-latest: reject newest
 *   - drop-oldest: evict oldest pending entry
 * - A pump loop dispatches work when capacity is available.
 * - Hooks emit observability-friendly events (queued/dispatch/reject/cancel).
 *
 * Usage:
 * - Instantiate with a `run(payload, queueWaitMs)` handler.
 * - Call `enqueue(payload, options)` to schedule work (optionally abortable).
 */

import { now as getNow } from './observability-utils'
import type { QueuePolicy, TaskDispatchOptions } from './types'

/** @internal */
export type DispatchQueueState = {
  inFlight: number
  pending: number
  waiting: number
  maxInFlight: number
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  paused: boolean
  disposed: boolean
}

/** @internal */
export type DispatchQueueHooks<T> = {
  onQueued?: (payload: T, pendingDepth: number, maxQueueDepth: number) => void
  onDispatch?: (payload: T, queueWaitMs: number) => void
  onReject?: (payload: T, error: Error) => void
  onCancel?: (payload: T, phase: 'waiting' | 'queued' | 'in-flight') => void
  onStateChange?: (state: DispatchQueueState) => void
  onIdle?: () => void
  onActive?: () => void
}

type QueueEntry<T> = {
  payload: T
  enqueuedAt: number
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  queuedAbortHandler?: () => void
  inFlightAbortHandler?: () => void
  attempt: number
  state: 'waiting' | 'pending' | 'in-flight'
}

type CapacityWaiter<T> = {
  entry: QueueEntry<T>
  resolve: () => void
  reject: (error: Error) => void
  abortHandler?: () => void
  active: boolean
}

/** @internal */
export class DispatchQueue<T> {
  private readonly pending: QueueEntry<T>[] = []
  private readonly capacityWaiters: CapacityWaiter<T>[] = []
  private readonly inFlight = new Set<QueueEntry<T>>()
  private readonly maxInFlight: number
  private readonly maxQueueDepth: number
  private readonly run: (payload: T, queueWaitMs: number) => Promise<unknown>
  private readonly hooks: DispatchQueueHooks<T>
  private readonly queuePolicy: QueuePolicy
  private pendingPermits: number
  private paused = false
  private disposed = false
  private wasIdle = true

  constructor(
    run: (payload: T, queueWaitMs: number) => Promise<unknown>,
    options: { maxInFlight: number; maxQueueDepth: number; queuePolicy: QueuePolicy },
    hooks: DispatchQueueHooks<T> = {}
  ) {
    this.run = run
    this.maxInFlight = options.maxInFlight
    this.maxQueueDepth = options.maxQueueDepth
    this.queuePolicy = options.queuePolicy
    this.hooks = hooks
    this.pendingPermits = this.usesPendingPermits() ? this.maxQueueDepth : 0
  }

  enqueue(payload: T, options?: TaskDispatchOptions): Promise<unknown> {
    // Enqueue a unit of work with optional cancellation.
    if (this.disposed) {
      const error = createDisposedError()
      this.hooks.onReject?.(payload, error)
      return Promise.reject(error)
    }

    const signal = options?.signal
    if (signal?.aborted) {
      const error = createAbortError()
      this.hooks.onCancel?.(payload, 'waiting')
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      const entry: QueueEntry<T> = {
        payload,
        enqueuedAt: getNow(),
        resolve,
        reject,
        signal,
        attempt: 0,
        state: 'waiting',
      }

      const startEnqueue = async () => {
        if (this.rejectIfDisposed(payload, reject)) return
        if (this.rejectIfAborted(payload, signal, reject)) return

        const permitResult = this.acquirePermitIfNeeded(entry, reject)
        const permitAcquired =
          typeof (permitResult as Promise<boolean | null>)?.then === 'function'
            ? await permitResult
            : permitResult
        if (permitAcquired === null) return

        if (this.rejectIfDisposed(payload, reject)) {
          if (permitAcquired) {
            this.releasePendingPermit()
            this.notifyCapacityWaiters()
            this.notifyStateChange()
          }
          return
        }
        if (this.rejectIfAborted(payload, signal, reject)) {
          if (permitAcquired) {
            this.releasePendingPermit()
            this.notifyCapacityWaiters()
            this.notifyStateChange()
          }
          return
        }
        if (this.applyOverflowPolicy(payload, reject)) return

        this.enqueueEntry(entry)
      }

      void startEnqueue()
    })
  }

  getState(): DispatchQueueState {
    return {
      inFlight: this.inFlight.size,
      pending: this.pending.length,
      waiting: this.capacityWaiters.length,
      maxInFlight: this.maxInFlight,
      maxQueueDepth: this.maxQueueDepth,
      queuePolicy: this.queuePolicy,
      paused: this.paused,
      disposed: this.disposed,
    }
  }

  pause(): void {
    // Pause dispatching without clearing the queue.
    if (this.disposed) return
    this.paused = true
  }

  resume(): void {
    // Resume dispatching and drain queued work.
    if (this.disposed) return
    if (!this.paused) return
    this.paused = false
    this.pump()
  }

  dispose(): void {
    // Permanently shut down the queue: reject all work and prevent new dispatches.
    if (this.disposed) return
    this.disposed = true
    this.paused = true
    const error = createDisposedError()

    for (const entry of this.pending.splice(0, this.pending.length)) {
      entry.state = 'pending'
      if (entry.queuedAbortHandler && entry.signal) {
        entry.signal.removeEventListener('abort', entry.queuedAbortHandler)
        entry.queuedAbortHandler = undefined
      }
      entry.reject(error)
    }
    if (this.usesPendingPermits()) {
      this.pendingPermits = this.maxQueueDepth
    }
    for (const waiter of this.capacityWaiters.splice(0, this.capacityWaiters.length)) {
      waiter.active = false
      if (waiter.abortHandler && waiter.entry.signal) {
        waiter.entry.signal.removeEventListener('abort', waiter.abortHandler)
        waiter.abortHandler = undefined
      }
      waiter.reject(error)
    }
    for (const entry of Array.from(this.inFlight)) {
      this.inFlight.delete(entry)
      if (entry.inFlightAbortHandler && entry.signal) {
        entry.signal.removeEventListener('abort', entry.inFlightAbortHandler)
        entry.inFlightAbortHandler = undefined
      }
      entry.reject(error)
    }
    this.notifyStateChange()
  }

  requeueInFlight(predicate: (payload: T) => boolean = () => true): T[] {
    // Move matching in-flight entries back to the queue (used when workers stop or crash).
    if (this.inFlight.size === 0) return []
    const toRequeue = Array.from(this.inFlight).filter(entry => predicate(entry.payload))
    if (toRequeue.length === 0) return []
    const requeued: T[] = []

    for (const entry of toRequeue) {
      this.inFlight.delete(entry)
      // Bump attempt so any completion from the terminated worker is ignored.
      entry.attempt += 1
      entry.state = 'in-flight'

      if (entry.inFlightAbortHandler && entry.signal) {
        entry.signal.removeEventListener('abort', entry.inFlightAbortHandler)
        entry.inFlightAbortHandler = undefined
      }

      if (entry.signal?.aborted) {
        this.hooks.onCancel?.(entry.payload, 'in-flight')
        entry.reject(createAbortError())
        continue
      }

      // Reset queue wait time for the requeued attempt.
      entry.enqueuedAt = getNow()
      requeued.push(entry.payload)

      entry.state = 'pending'
      this.pending.unshift(entry)
      this.consumePendingPermit()
      this.hooks.onQueued?.(entry.payload, this.pending.length, this.maxQueueDepth)
      this.attachQueuedAbortHandler(entry)
    }
    this.pump()
    return requeued
  }

  rejectInFlight(predicate: (payload: T) => boolean, error: Error): T[] {
    if (this.inFlight.size === 0) return []
    const toReject = Array.from(this.inFlight).filter(entry => predicate(entry.payload))
    if (toReject.length === 0) return []
    const rejected: T[] = []

    for (const entry of toReject) {
      this.inFlight.delete(entry)
      if (entry.inFlightAbortHandler && entry.signal) {
        entry.signal.removeEventListener('abort', entry.inFlightAbortHandler)
        entry.inFlightAbortHandler = undefined
      }
      entry.reject(error)
      rejected.push(entry.payload)
    }
    this.pump()
    return rejected
  }

  rejectAll(error: Error): { pending: T[]; waiting: T[]; inFlight: T[] } {
    const pendingPayloads: T[] = []
    const waitingPayloads: T[] = []
    const inFlightPayloads: T[] = []
    for (const entry of this.pending.splice(0, this.pending.length)) {
      if (entry.queuedAbortHandler && entry.signal) {
        entry.signal.removeEventListener('abort', entry.queuedAbortHandler)
        entry.queuedAbortHandler = undefined
      }
      entry.reject(error)
      pendingPayloads.push(entry.payload)
    }
    if (this.usesPendingPermits()) {
      this.pendingPermits = this.maxQueueDepth
    }
    for (const waiter of this.capacityWaiters.splice(0, this.capacityWaiters.length)) {
      waiter.active = false
      if (waiter.abortHandler && waiter.entry.signal) {
        waiter.entry.signal.removeEventListener('abort', waiter.abortHandler)
        waiter.abortHandler = undefined
      }
      waiter.reject(error)
      waitingPayloads.push(waiter.entry.payload)
    }
    for (const entry of Array.from(this.inFlight)) {
      this.inFlight.delete(entry)
      if (entry.inFlightAbortHandler && entry.signal) {
        entry.signal.removeEventListener('abort', entry.inFlightAbortHandler)
        entry.inFlightAbortHandler = undefined
      }
      entry.reject(error)
      inFlightPayloads.push(entry.payload)
    }
    this.notifyStateChange()
    return { pending: pendingPayloads, waiting: waitingPayloads, inFlight: inFlightPayloads }
  }

  isIdle(): boolean {
    return (
      this.inFlight.size === 0 && this.pending.length === 0 && this.capacityWaiters.length === 0
    )
  }

  private pump(): void {
    // Scheduler loop: dispatch pending work while capacity is available.
    if (this.paused || this.disposed) {
      this.notifyStateChange()
      return
    }
    while (this.inFlight.size < this.maxInFlight && this.pending.length > 0) {
      if (this.paused || this.disposed) break
      const entry = this.pending.shift()
      if (!entry) continue
      if (entry.signal && entry.queuedAbortHandler) {
        entry.signal.removeEventListener('abort', entry.queuedAbortHandler)
        entry.queuedAbortHandler = undefined
      }
      this.releasePendingPermit()

      const queueWaitMs = getNow() - entry.enqueuedAt
      entry.state = 'in-flight'
      // Bump attempt so any completion from a previous dispatch is ignored.
      entry.attempt += 1
      const attempt = entry.attempt
      this.inFlight.add(entry)
      this.hooks.onDispatch?.(entry.payload, queueWaitMs)

      this.notifyCapacityWaiters()

      let settled = false
      const finish = () => {
        if (this.inFlight.delete(entry)) {
          this.pump()
        } else {
          this.notifyStateChange()
        }
      }

      const signal = entry.signal
      let abortHandler: (() => void) | null = null
      if (signal) {
        abortHandler = () => {
          if (settled) return
          settled = true
          this.hooks.onCancel?.(entry.payload, 'in-flight')
          entry.reject(createAbortError())
        }
        signal.addEventListener('abort', abortHandler, { once: true })
        entry.inFlightAbortHandler = abortHandler
      }

      Promise.resolve()
        .then(() => this.run(entry.payload, queueWaitMs))
        .then(
          value => {
            // Ignore stale completions if this entry was requeued/re-dispatched.
            if (!settled && entry.attempt === attempt && this.inFlight.has(entry)) {
              settled = true
              entry.resolve(value)
            }
          },
          error => {
            // Ignore stale completions if this entry was requeued/re-dispatched.
            if (!settled && entry.attempt === attempt && this.inFlight.has(entry)) {
              settled = true
              entry.reject(error)
            }
          }
        )
        .finally(() => {
          if (abortHandler && signal) {
            signal.removeEventListener('abort', abortHandler)
          }
          finish()
        })
    }

    this.notifyStateChange()
  }

  private notifyStateChange(): void {
    this.hooks.onStateChange?.(this.getState())
    // Emit idle/active transitions for idle-timeout handling.
    const idle = this.isIdle()
    if (idle && !this.wasIdle) {
      this.wasIdle = true
      this.hooks.onIdle?.()
    } else if (!idle && this.wasIdle) {
      this.wasIdle = false
      this.hooks.onActive?.()
    }
  }

  private rejectIfDisposed(payload: T, reject: (error: unknown) => void): boolean {
    if (!this.disposed) return false
    const error = createDisposedError()
    this.hooks.onReject?.(payload, error)
    reject(error)
    return true
  }

  private rejectIfAborted(
    payload: T,
    signal: AbortSignal | undefined,
    reject: (error: unknown) => void
  ): boolean {
    if (!signal?.aborted) return false
    const error = createAbortError()
    this.hooks.onCancel?.(payload, 'waiting')
    reject(error)
    return true
  }

  private acquirePermitIfNeeded(
    entry: QueueEntry<T>,
    reject: (error: unknown) => void
  ): boolean | null | Promise<boolean | null> {
    if (!this.usesPendingPermits()) return false

    const waitForPermit = this.acquirePendingPermit(entry)
    if (!waitForPermit) {
      return true
    }

    return waitForPermit.then(
      () => true,
      error => {
        reject(error)
        return null
      }
    )
  }

  private applyOverflowPolicy(payload: T, reject: (error: unknown) => void): boolean {
    if (this.queuePolicy === 'block' || this.pending.length < this.maxQueueDepth) {
      return false
    }

    if (this.queuePolicy === 'drop-oldest') {
      const dropped = this.pending.shift()
      if (dropped) {
        const dropError = createDropError('drop-oldest')
        if (dropped.queuedAbortHandler && dropped.signal) {
          dropped.signal.removeEventListener('abort', dropped.queuedAbortHandler)
          dropped.queuedAbortHandler = undefined
        }
        dropped.reject(dropError)
        this.hooks.onReject?.(dropped.payload, dropError)
      }
      return false
    }

    const error = createDropError(this.queuePolicy === 'drop-latest' ? 'drop-latest' : 'reject')
    this.hooks.onReject?.(payload, error)
    reject(error)
    return true
  }

  private enqueueEntry(entry: QueueEntry<T>): void {
    this.pending.push(entry)
    entry.state = 'pending'
    this.hooks.onQueued?.(entry.payload, this.pending.length, this.maxQueueDepth)
    this.attachQueuedAbortHandler(entry)
    this.pump()
  }

  private usesPendingPermits(): boolean {
    return this.queuePolicy === 'block' && Number.isFinite(this.maxQueueDepth)
  }

  private consumePendingPermit(): void {
    if (!this.usesPendingPermits()) return
    this.pendingPermits -= 1
  }

  private releasePendingPermit(): void {
    if (!this.usesPendingPermits()) return
    this.pendingPermits += 1
  }

  private acquirePendingPermit(entry: QueueEntry<T>): Promise<void> | null {
    if (this.disposed) {
      return Promise.reject(createDisposedError())
    }
    if (!this.usesPendingPermits()) {
      return null
    }
    if (this.pendingPermits > 0 && this.capacityWaiters.length === 0) {
      this.pendingPermits -= 1
      return null
    }

    return new Promise((resolve, reject) => {
      const waiter: CapacityWaiter<T> = { entry, resolve, reject, active: true }

      const onAbort = () => {
        if (!waiter.active) return
        waiter.active = false
        this.removeWaiter(waiter)
        this.hooks.onCancel?.(entry.payload, 'waiting')
        reject(createAbortError())
        this.notifyStateChange()
      }

      if (entry.signal) {
        waiter.abortHandler = onAbort
        entry.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.capacityWaiters.push(waiter)
      this.notifyStateChange()
    })
  }

  private removeWaiter(waiter: CapacityWaiter<T>): void {
    const index = this.capacityWaiters.indexOf(waiter)
    if (index !== -1) {
      this.capacityWaiters.splice(index, 1)
    }
  }

  private notifyCapacityWaiters(): void {
    if (!this.usesPendingPermits()) return
    let released = false

    while (this.capacityWaiters.length > 0 && this.pendingPermits > 0) {
      const waiter = this.capacityWaiters.shift()
      if (!waiter) break
      waiter.active = false
      if (waiter.abortHandler && waiter.entry.signal) {
        waiter.entry.signal.removeEventListener('abort', waiter.abortHandler)
        waiter.abortHandler = undefined
      }
      this.pendingPermits -= 1
      waiter.resolve()
      released = true
    }

    if (released) {
      this.notifyStateChange()
    }
  }

  private attachQueuedAbortHandler(entry: QueueEntry<T>): void {
    // Cancel queued entries when their AbortSignal fires.
    if (!entry.signal) return
    if (entry.queuedAbortHandler) return
    if (!this.pending.includes(entry)) {
      return
    }
    const payload = entry.payload
    const onAbort = () => {
      const pendingIndex = this.pending.indexOf(entry)
      if (pendingIndex !== -1) {
        this.pending.splice(pendingIndex, 1)
        this.hooks.onCancel?.(payload, 'queued')
        entry.reject(createAbortError())
        this.releasePendingPermit()
        this.notifyCapacityWaiters()
        this.notifyStateChange()
      }
    }
    entry.queuedAbortHandler = onAbort
    entry.signal.addEventListener('abort', onAbort, { once: true })
  }
}

const createAbortError = () => {
  const error = new Error('Task was aborted')
  ;(error as Error & { name?: string }).name = 'AbortError'
  return error
}

const createDropError = (policy: 'drop-oldest' | 'drop-latest' | 'reject') => {
  const error = new Error(`Task queue policy '${policy}' dropped item`)
  ;(error as Error & { name?: string }).name = 'QueueDropError'
  return error
}

const createDisposedError = () => {
  const error = new Error('Task was disposed')
  ;(error as Error & { name?: string }).name = 'TaskDisposedError'
  return error
}
