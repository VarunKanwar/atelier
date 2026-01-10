import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
}))

import { SingletonWorker } from '../../core/singleton-worker'
import type { TaskEvent } from '../../core/types'
import { WorkerCrashedError } from '../../core/worker-crash-error'
import { WorkerPool } from '../../core/worker-pool'
import { deferred, tick as flush } from '../helpers/deferred'
import { type DispatchHandler, FakeWorker } from '../helpers/fake-worker'

const makeWorkerFactory = (dispatches: DispatchHandler[]) => {
  const created: FakeWorker[] = []
  const createWorker = () => {
    const dispatch = dispatches.shift()
    if (!dispatch) {
      throw new Error('No dispatch handler available')
    }
    const worker = new FakeWorker(dispatch)
    created.push(worker)
    return worker as unknown as Worker
  }
  return { createWorker, created }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('worker crash recovery', () => {
  it('singleton restart-fail-in-flight rejects in-flight and restarts with backoff', async () => {
    vi.useFakeTimers()
    const events: TaskEvent[] = []

    const firstGate = deferred<string>()
    const { createWorker, created } = makeWorkerFactory([
      async () => firstGate.promise,
      async () => 'recovered',
    ])

    const worker = new SingletonWorker(
      createWorker,
      'lazy',
      event => events.push(event),
      'task-1',
      'Test Task',
      1,
      Number.POSITIVE_INFINITY,
      'block',
      'restart-fail-in-flight',
      3
    )

    const promise = worker.dispatch('run', [])
    await flush()

    expect(created.length).toBe(1)
    created[0].emitError(new Error('boom'))

    await expect(promise).rejects.toBeInstanceOf(WorkerCrashedError)
    expect(worker.getState().workerStatus).toBe('crashed')
    expect(worker.getState().lastCrash).toBeTruthy()
    expect(events.some(event => event.type === 'worker:crash')).toBe(true)

    vi.advanceTimersByTime(99)
    await flush()
    expect(created.length).toBe(1)

    vi.advanceTimersByTime(1)
    await flush()
    expect(created.length).toBe(2)

    const result = await worker.dispatch('run', [])
    expect(result).toBe('recovered')
  })

  it('worker pool restart-requeue-in-flight requeues and resolves', async () => {
    vi.useFakeTimers()

    const gate = deferred<string>()
    const { createWorker, created } = makeWorkerFactory([
      async () => gate.promise,
      async () => 'ok',
    ])

    const pool = new WorkerPool(
      createWorker,
      1,
      'lazy',
      undefined,
      'task-2',
      'Pool Task',
      1,
      Number.POSITIVE_INFINITY,
      'block',
      'restart-requeue-in-flight',
      3
    )

    const promise = pool.dispatch('run', [])
    await flush()

    expect(created.length).toBe(1)
    created[0].emitMessageError({ reason: 'boom' })

    vi.advanceTimersByTime(100)
    await flush()

    const result = await promise
    expect(result).toBe('ok')
  })

  it('escalates to fail-task after crashMaxRetries is exceeded', async () => {
    vi.useFakeTimers()

    const gateOne = deferred<string>()
    const gateTwo = deferred<string>()

    const { createWorker, created } = makeWorkerFactory([
      async () => gateOne.promise,
      async () => gateTwo.promise,
    ])

    const pool = new WorkerPool(
      createWorker,
      1,
      'lazy',
      undefined,
      'task-3',
      'Retry Task',
      1,
      Number.POSITIVE_INFINITY,
      'block',
      'restart-fail-in-flight',
      1
    )

    const first = pool.dispatch('run', [])
    await flush()
    created[0].emitError(new Error('boom-1'))
    await expect(first).rejects.toBeInstanceOf(WorkerCrashedError)

    vi.advanceTimersByTime(100)
    await flush()
    expect(created.length).toBe(2)

    const second = pool.dispatch('run', [])
    await flush()
    created[1].emitError(new Error('boom-2'))
    await expect(second).rejects.toBeInstanceOf(WorkerCrashedError)

    const third = pool.dispatch('run', [])
    await expect(third).rejects.toBeInstanceOf(WorkerCrashedError)
  })
})
