import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
}))

import { createTaskRuntime } from '../../core/runtime'
import { deferred, tick } from '../helpers/deferred'
import { type DispatchHandler, FakeWorker } from '../helpers/fake-worker'

type TestAPI = {
  echo: (value: string) => Promise<string>
  add: (a: number, b: number) => Promise<number>
  slow: () => Promise<string>
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

describe('Task Runtime', () => {
  describe('defineTask and dispatch', () => {
    it('dispatches to a singleton task and returns result', async () => {
      const runtime = createTaskRuntime()
      const { createWorker } = makeWorkerFactory([
        async (_callId, method, args) => {
          if (method === 'echo') return `echoed: ${args[0]}`
          return null
        },
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      const result = await task.echo('hello')
      expect(result).toBe('echoed: hello')
    })

    it('dispatches to a parallel task and returns result', async () => {
      const runtime = createTaskRuntime()
      const { createWorker } = makeWorkerFactory([
        async (_callId, method, args) => {
          if (method === 'add') return (args[0] as number) + (args[1] as number)
          return null
        },
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'parallel',
        poolSize: 1,
        worker: createWorker,
      })

      const result = await task.add(2, 3)
      expect(result).toBe(5)
    })

    it('dispatches multiple calls to parallel pool', async () => {
      const runtime = createTaskRuntime()
      const gates = [deferred<string>(), deferred<string>()]
      const _callCount = 0

      const { createWorker } = makeWorkerFactory([
        async () => gates[0].promise,
        async () => gates[1].promise,
      ])

      const task = runtime.defineTask<TestAPI>({
        type: 'parallel',
        poolSize: 2,
        worker: createWorker,
      })

      const first = task.echo('a')
      const second = task.echo('b')
      await tick()

      expect(task.getState().queueDepth).toBe(2)

      gates[0].resolve('first')
      gates[1].resolve('second')

      const results = await Promise.all([first, second])
      expect(results).toEqual(['first', 'second'])
    })
  })

  describe('keyed cancellation', () => {
    it('cancels dispatched call when key is aborted', async () => {
      const runtime = createTaskRuntime()
      const gate = deferred<string>()

      const { createWorker } = makeWorkerFactory([async () => gate.promise])

      const task = runtime.defineTask<{ process: (docId: string) => Promise<string> }>({
        type: 'singleton',
        worker: createWorker,
        keyOf: docId => docId,
      })

      const promise = task.process('doc-1')
      await tick()

      runtime.abortTaskController.abort('doc-1')

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
      gate.resolve('done')
    })

    it('does not affect other keys when one is aborted', async () => {
      const runtime = createTaskRuntime()
      const gates = [deferred<string>(), deferred<string>()]
      let callIndex = 0

      const { createWorker } = makeWorkerFactory([
        async () => gates[callIndex++].promise,
        async () => gates[callIndex++].promise,
      ])

      const task = runtime.defineTask<{ process: (docId: string) => Promise<string> }>({
        type: 'parallel',
        poolSize: 2,
        worker: createWorker,
        keyOf: docId => docId,
      })

      const first = task.process('doc-1')
      const second = task.process('doc-2')
      await tick()

      runtime.abortTaskController.abort('doc-1')

      await expect(first).rejects.toMatchObject({ name: 'AbortError' })

      gates[1].resolve('doc-2-result')
      const result = await second
      expect(result).toBe('doc-2-result')

      gates[0].resolve('ignored')
    })

    it('multiple tasks share the same abort controller', async () => {
      const runtime = createTaskRuntime()
      const gate1 = deferred<string>()
      const gate2 = deferred<string>()

      const { createWorker: createWorker1 } = makeWorkerFactory([async () => gate1.promise])
      const { createWorker: createWorker2 } = makeWorkerFactory([async () => gate2.promise])

      const task1 = runtime.defineTask<{ process: (id: string) => Promise<string> }>({
        type: 'singleton',
        worker: createWorker1,
        keyOf: id => id,
      })

      const task2 = runtime.defineTask<{ process: (id: string) => Promise<string> }>({
        type: 'singleton',
        worker: createWorker2,
        keyOf: id => id,
      })

      // Start both calls and capture their rejections
      const promise1 = task1.process('shared-key').catch(e => e)
      await tick()
      const promise2 = task2.process('shared-key').catch(e => e)
      await tick()

      runtime.abortTaskController.abort('shared-key')

      const [error1, error2] = await Promise.all([promise1, promise2])
      expect(error1.name).toBe('AbortError')
      expect(error2.name).toBe('AbortError')

      gate1.resolve('done')
      gate2.resolve('done')
    })
  })

  describe('timeout', () => {
    it('aborts call after timeoutMs', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()
      const gate = deferred<string>()

      const { createWorker } = makeWorkerFactory([async () => gate.promise])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        timeoutMs: 1000,
      })

      const promise = task.slow()
      await tick()

      vi.advanceTimersByTime(999)
      await tick()

      // Should still be pending
      expect(task.getState().queueDepth).toBe(1)

      vi.advanceTimersByTime(1)
      await tick()

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
      gate.resolve('done')
    })

    it('completes successfully if finished before timeout', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()

      const { createWorker } = makeWorkerFactory([async () => 'quick-result'])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        timeoutMs: 1000,
      })

      const promise = task.slow()
      await tick()

      const result = await promise
      expect(result).toBe('quick-result')
    })
  })

  describe('task state', () => {
    it('getState returns current queue and worker state', async () => {
      const runtime = createTaskRuntime()
      const gate = deferred<string>()

      const { createWorker } = makeWorkerFactory([async () => gate.promise])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'reject',
      })

      const state1 = task.getState()
      expect(state1.type).toBe('singleton')
      expect(state1.queueDepth).toBe(0)
      expect(state1.maxInFlight).toBe(1)
      expect(state1.maxQueueDepth).toBe(10)
      expect(state1.queuePolicy).toBe('reject')

      task.echo('test')
      await tick()

      const state2 = task.getState()
      expect(state2.queueDepth).toBe(1)
      expect(state2.totalDispatched).toBe(1)

      gate.resolve('done')
    })
  })

  describe('dispose', () => {
    it('rejects pending calls on dispose', async () => {
      const runtime = createTaskRuntime()
      const gate = deferred<string>()

      const { createWorker } = makeWorkerFactory([async () => gate.promise])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      const promise = task.echo('test')
      await tick()

      task.dispose()

      await expect(promise).rejects.toMatchObject({ name: 'TaskDisposedError' })
      gate.resolve('done')
    })

    it('rejects new calls after dispose', async () => {
      const runtime = createTaskRuntime()

      const { createWorker } = makeWorkerFactory([async () => 'ok'])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      task.dispose()

      await expect(task.echo('test')).rejects.toMatchObject({ name: 'TaskDisposedError' })
    })

    it('removes task from runtime snapshot after dispose', async () => {
      const runtime = createTaskRuntime()

      const { createWorker } = makeWorkerFactory([async () => 'ok'])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        taskId: 'my-task',
      })

      expect(runtime.getRuntimeSnapshot().tasks).toHaveLength(1)
      expect(runtime.getRuntimeSnapshot().tasks[0].taskId).toBe('my-task')

      task.dispose()

      expect(runtime.getRuntimeSnapshot().tasks).toHaveLength(0)
    })
  })
})
