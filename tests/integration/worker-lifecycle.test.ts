import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
}))

import { createTaskRuntime } from '../../core/runtime'
import { FakeWorker, type DispatchHandler } from '../helpers/fake-worker'
import { deferred, tick } from '../helpers/deferred'

type TestAPI = {
  work: () => Promise<string>
}

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

describe('Worker Lifecycle', () => {
  describe('init modes', () => {
    it('lazy: does not create workers until first dispatch', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'lazy',
      })

      expect(created).toHaveLength(0)
      expect(task.getState().workerStatus).toBe('stopped')

      await task.work()

      expect(created).toHaveLength(1)
      expect(task.getState().workerStatus).toBe('running')
    })

    it('eager: creates workers immediately on defineTask', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(1)
      expect(task.getState().workerStatus).toBe('running')
    })

    it('eager parallel: creates all pool workers immediately', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'a',
        async () => 'b',
        async () => 'c',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'parallel',
        poolSize: 3,
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(3)
      expect(task.getState().activeWorkers).toBe(3)
    })
  })

  describe('startWorkers / stopWorkers', () => {
    it('startWorkers on eager task restarts stopped workers', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'first',
        async () => 'second',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(1)

      task.stopWorkers()
      expect(task.getState().workerStatus).toBe('stopped')

      task.startWorkers()
      expect(created).toHaveLength(2)
      expect(task.getState().workerStatus).toBe('running')
    })

    it('startWorkers on lazy task resumes queue but does not create workers', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'lazy',
      })

      expect(created).toHaveLength(0)

      // startWorkers on lazy init just resumes the queue
      task.startWorkers()
      expect(created).toHaveLength(0)

      // Workers are created on first dispatch
      await task.work()
      expect(created).toHaveLength(1)
    })

    it('stopWorkers terminates workers', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(1)
      expect(created[0].terminated).toBe(false)

      task.stopWorkers()

      expect(created[0].terminated).toBe(true)
      expect(task.getState().workerStatus).toBe('stopped')
    })

    it('stopWorkers on parallel pool terminates all workers', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'a',
        async () => 'b',
        async () => 'c',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'parallel',
        poolSize: 3,
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(3)

      task.stopWorkers()

      expect(created.every((w) => w.terminated)).toBe(true)
      expect(task.getState().workerStatus).toBe('stopped')
    })
  })

  describe('idle timeout', () => {
    it('auto-stops workers after idle period', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
        async () => 'second',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'lazy',
        idleTimeoutMs: 1000,
      })

      // Trigger worker creation
      await task.work()
      expect(created).toHaveLength(1)
      expect(task.getState().workerStatus).toBe('running')

      // Wait less than idle timeout
      vi.advanceTimersByTime(500)
      await tick()
      expect(task.getState().workerStatus).toBe('running')
      expect(created[0].terminated).toBe(false)

      // Wait past idle timeout
      vi.advanceTimersByTime(500)
      await tick()
      expect(task.getState().workerStatus).toBe('stopped')
      expect(created[0].terminated).toBe(true)

      // New work restarts workers
      await task.work()
      expect(created).toHaveLength(2)
      expect(task.getState().workerStatus).toBe('running')
    })

    it('resets idle timer on new work', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'a',
        async () => 'b',
        async () => 'c',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'lazy',
        idleTimeoutMs: 1000,
      })

      await task.work()
      expect(created).toHaveLength(1)

      // Wait 800ms
      vi.advanceTimersByTime(800)
      await tick()

      // Do more work - should reset timer
      await task.work()

      // Wait another 800ms (total 1600ms since first work, but only 800ms since last)
      vi.advanceTimersByTime(800)
      await tick()

      // Should still be running
      expect(task.getState().workerStatus).toBe('running')
      expect(created[0].terminated).toBe(false)

      // Wait past the timeout from last work
      vi.advanceTimersByTime(200)
      await tick()

      expect(task.getState().workerStatus).toBe('stopped')
    })
  })

  describe('dispose', () => {
    it('terminates workers on dispose', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(1)
      expect(created[0].terminated).toBe(false)

      task.dispose()

      expect(created[0].terminated).toBe(true)
    })

    it('dispose parallel pool terminates all workers', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'a',
        async () => 'b',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'parallel',
        poolSize: 2,
        worker: createWorker,
        init: 'eager',
      })

      expect(created).toHaveLength(2)

      task.dispose()

      expect(created.every((w) => w.terminated)).toBe(true)
    })

    it('cannot startWorkers after dispose', async () => {
      const runtime = createTaskRuntime()
      const { createWorker, created } = makeWorkerFactory([
        async () => 'result',
        async () => 'second',
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        init: 'eager',
      })

      task.dispose()

      // startWorkers should be a no-op after dispose
      task.startWorkers()
      expect(created).toHaveLength(1)
    })
  })
})
