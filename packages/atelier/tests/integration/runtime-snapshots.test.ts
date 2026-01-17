import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
}))

import { createTaskRuntime } from '../../src/runtime'
import { deferred, tick } from '../helpers/deferred'
import { type DispatchHandler, FakeWorker } from '../helpers/fake-worker'

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

describe('Runtime Snapshots', () => {
  describe('getRuntimeSnapshot', () => {
    it('returns empty tasks array with no defined tasks', () => {
      const runtime = createTaskRuntime()
      const snapshot = runtime.getRuntimeSnapshot()

      expect(snapshot.tasks).toEqual([])
    })

    it('includes all defined tasks', () => {
      const runtime = createTaskRuntime()

      const { createWorker: cw1 } = makeWorkerFactory([async () => 'a'])
      const { createWorker: cw2 } = makeWorkerFactory([async () => 'b'])

      runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: cw1,
        taskId: 'task-1',
        taskName: 'First Task',
      })

      runtime.defineTask<TestAPI>({
        type: 'parallel',
        poolSize: 4,
        worker: cw2,
        taskId: 'task-2',
        taskName: 'Second Task',
      })

      const snapshot = runtime.getRuntimeSnapshot()

      expect(snapshot.tasks).toHaveLength(2)

      const task1 = snapshot.tasks.find(t => t.taskId === 'task-1')
      expect(task1).toBeDefined()
      expect(task1?.taskName).toBe('First Task')
      expect(task1?.type).toBe('singleton')
      expect(task1?.init).toBe('lazy')

      const task2 = snapshot.tasks.find(t => t.taskId === 'task-2')
      expect(task2).toBeDefined()
      expect(task2?.taskName).toBe('Second Task')
      expect(task2?.type).toBe('parallel')
      expect(task2?.poolSize).toBe(4)
    })

    it('reflects current queue state', async () => {
      const runtime = createTaskRuntime()
      const gate = deferred<string>()

      const { createWorker } = makeWorkerFactory([async () => gate.promise])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        taskId: 'my-task',
      })

      const snapshot1 = runtime.getRuntimeSnapshot()
      expect(snapshot1.tasks[0].queueDepth).toBe(0)
      expect(snapshot1.tasks[0].totalDispatched).toBe(0)

      task.work()
      await tick()

      const snapshot2 = runtime.getRuntimeSnapshot()
      expect(snapshot2.tasks[0].queueDepth).toBe(1)
      expect(snapshot2.tasks[0].totalDispatched).toBe(1)

      gate.resolve('done')
    })

    it('removes disposed tasks from snapshot', () => {
      const runtime = createTaskRuntime()

      const { createWorker } = makeWorkerFactory([async () => 'result'])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        taskId: 'disposable',
      })

      expect(runtime.getRuntimeSnapshot().tasks).toHaveLength(1)

      task.dispose()

      expect(runtime.getRuntimeSnapshot().tasks).toHaveLength(0)
    })
  })

  describe('subscribeRuntimeSnapshot', () => {
    it('emits immediately by default', () => {
      const runtime = createTaskRuntime()
      const { createWorker } = makeWorkerFactory([async () => 'result'])

      runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        taskId: 'test-task',
      })

      const snapshots: unknown[] = []
      const unsubscribe = runtime.subscribeRuntimeSnapshot(snapshot => {
        snapshots.push(snapshot)
      })

      expect(snapshots).toHaveLength(1)
      expect((snapshots[0] as { tasks: unknown[] }).tasks).toHaveLength(1)

      unsubscribe()
    })

    it('does not emit immediately when emitImmediately is false', () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()

      const snapshots: unknown[] = []
      const unsubscribe = runtime.subscribeRuntimeSnapshot(
        snapshot => {
          snapshots.push(snapshot)
        },
        { emitImmediately: false }
      )

      expect(snapshots).toHaveLength(0)

      vi.advanceTimersByTime(250)
      expect(snapshots).toHaveLength(1)

      unsubscribe()
    })

    it('emits at specified interval', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()

      const snapshots: unknown[] = []
      const unsubscribe = runtime.subscribeRuntimeSnapshot(
        snapshot => {
          snapshots.push(snapshot)
        },
        { intervalMs: 100, emitImmediately: false }
      )

      expect(snapshots).toHaveLength(0)

      vi.advanceTimersByTime(100)
      expect(snapshots).toHaveLength(1)

      vi.advanceTimersByTime(100)
      expect(snapshots).toHaveLength(2)

      vi.advanceTimersByTime(100)
      expect(snapshots).toHaveLength(3)

      unsubscribe()
    })

    it('stops emitting after unsubscribe', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()

      const snapshots: unknown[] = []
      const unsubscribe = runtime.subscribeRuntimeSnapshot(
        snapshot => {
          snapshots.push(snapshot)
        },
        { intervalMs: 100, emitImmediately: false }
      )

      vi.advanceTimersByTime(100)
      expect(snapshots).toHaveLength(1)

      unsubscribe()

      vi.advanceTimersByTime(100)
      expect(snapshots).toHaveLength(1) // No new emissions
    })

    it('only emits on change when onlyOnChange is true', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()
      const gate = deferred<string>()

      const { createWorker } = makeWorkerFactory([async () => gate.promise])

      const task = runtime.defineTask<TestAPI>({
        type: 'singleton',
        worker: createWorker,
        taskId: 'test-task',
      })

      const snapshots: unknown[] = []
      const unsubscribe = runtime.subscribeRuntimeSnapshot(
        snapshot => {
          snapshots.push(snapshot)
        },
        { intervalMs: 50, emitImmediately: true, onlyOnChange: true }
      )

      // Initial emission
      expect(snapshots).toHaveLength(1)

      // No change - should not emit
      vi.advanceTimersByTime(50)
      expect(snapshots).toHaveLength(1)

      vi.advanceTimersByTime(50)
      expect(snapshots).toHaveLength(1)

      // Trigger a change
      task.work()
      await tick()

      vi.advanceTimersByTime(50)
      expect(snapshots).toHaveLength(2)

      // No more changes - should not emit
      vi.advanceTimersByTime(50)
      expect(snapshots).toHaveLength(2)

      unsubscribe()
      gate.resolve('done')
    })

    it('multiple subscribers receive independent updates', async () => {
      vi.useFakeTimers()
      const runtime = createTaskRuntime()

      const snapshots1: unknown[] = []
      const snapshots2: unknown[] = []

      const unsub1 = runtime.subscribeRuntimeSnapshot(snapshot => snapshots1.push(snapshot), {
        intervalMs: 100,
        emitImmediately: false,
      })

      const unsub2 = runtime.subscribeRuntimeSnapshot(snapshot => snapshots2.push(snapshot), {
        intervalMs: 50,
        emitImmediately: false,
      })

      vi.advanceTimersByTime(100)

      expect(snapshots1).toHaveLength(1)
      expect(snapshots2).toHaveLength(2)

      unsub1()
      unsub2()
    })
  })
})
