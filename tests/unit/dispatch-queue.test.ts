import { describe, expect, it, vi } from 'vitest'
import { DispatchQueue } from '../../core/dispatch-queue'
import { deferred, tick } from '../helpers/deferred'

type Payload = { id: string }

describe('DispatchQueue', () => {
  describe('basic dispatch', () => {
    it('dispatches and returns result', async () => {
      const queue = new DispatchQueue<Payload>(async payload => `result-${payload.id}`, {
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      const result = await queue.enqueue({ id: 'a' })
      expect(result).toBe('result-a')
    })

    it('respects maxInFlight limit', async () => {
      const gates = [deferred<string>(), deferred<string>()]
      let dispatchCount = 0

      const queue = new DispatchQueue<Payload>(
        async _payload => {
          const idx = dispatchCount++
          return gates[idx].promise
        },
        { maxInFlight: 1, maxQueueDepth: 10, queuePolicy: 'block' }
      )

      const first = queue.enqueue({ id: 'a' })
      const second = queue.enqueue({ id: 'b' })
      await tick()

      expect(queue.getState().inFlight).toBe(1)
      expect(queue.getState().pending).toBe(1)

      gates[0].resolve('first')
      await first
      await tick()

      expect(queue.getState().inFlight).toBe(1)
      expect(queue.getState().pending).toBe(0)

      gates[1].resolve('second')
      await second
    })

    it('processes multiple items in parallel up to maxInFlight', async () => {
      const gates = [deferred<string>(), deferred<string>(), deferred<string>()]
      let dispatchCount = 0

      const queue = new DispatchQueue<Payload>(async () => gates[dispatchCount++].promise, {
        maxInFlight: 2,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      queue.enqueue({ id: 'a' })
      queue.enqueue({ id: 'b' })
      queue.enqueue({ id: 'c' })
      await tick()

      expect(queue.getState().inFlight).toBe(2)
      expect(queue.getState().pending).toBe(1)

      gates[0].resolve('a')
      gates[1].resolve('b')
      gates[2].resolve('c')
    })
  })

  describe('queue policies', () => {
    it('reject: rejects immediately when queue is full', async () => {
      const gate = deferred<string>()
      const queue = new DispatchQueue<Payload>(async () => gate.promise, {
        maxInFlight: 1,
        maxQueueDepth: 1,
        queuePolicy: 'reject',
      })

      queue.enqueue({ id: 'in-flight' })
      queue.enqueue({ id: 'pending' })
      await tick()

      const rejected = queue.enqueue({ id: 'overflow' })
      await expect(rejected).rejects.toMatchObject({ name: 'QueueDropError' })

      gate.resolve('done')
    })

    it('drop-latest: rejects newest item when queue is full', async () => {
      const gate = deferred<string>()
      const queue = new DispatchQueue<Payload>(async () => gate.promise, {
        maxInFlight: 1,
        maxQueueDepth: 1,
        queuePolicy: 'drop-latest',
      })

      queue.enqueue({ id: 'in-flight' })
      queue.enqueue({ id: 'pending' })
      await tick()

      const rejected = queue.enqueue({ id: 'overflow' })
      await expect(rejected).rejects.toMatchObject({ name: 'QueueDropError' })

      gate.resolve('done')
    })

    it('drop-oldest: evicts oldest pending item when queue is full', async () => {
      const gate = deferred<string>()
      const results: string[] = []
      let dispatched = 0

      const queue = new DispatchQueue<Payload>(
        async payload => {
          if (dispatched++ === 0) {
            await gate.promise
          }
          results.push(payload.id)
          return payload.id
        },
        { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'drop-oldest' }
      )

      const inFlight = queue.enqueue({ id: 'in-flight' })
      const pending = queue.enqueue({ id: 'will-be-dropped' })
      await tick()

      const newItem = queue.enqueue({ id: 'new-item' })
      await tick()

      await expect(pending).rejects.toMatchObject({ name: 'QueueDropError' })

      gate.resolve('done')
      await inFlight
      await newItem

      expect(results).toContain('new-item')
      expect(results).not.toContain('will-be-dropped')
    })

    it('block: holds items in blocked queue until capacity available', async () => {
      const gate = deferred<string>()
      const queue = new DispatchQueue<Payload>(async () => gate.promise, {
        maxInFlight: 1,
        maxQueueDepth: 1,
        queuePolicy: 'block',
      })

      queue.enqueue({ id: 'in-flight' })
      queue.enqueue({ id: 'pending' })
      const blocked = queue.enqueue({ id: 'blocked' })
      await tick()

      expect(queue.getState().inFlight).toBe(1)
      expect(queue.getState().pending).toBe(1)
      expect(queue.getState().blocked).toBe(1)

      gate.resolve('done')
      const result = await blocked
      expect(result).toBe('done')
    })
  })

  describe('getState', () => {
    it('returns current queue state', async () => {
      const queue = new DispatchQueue<Payload>(async () => 'ok', {
        maxInFlight: 2,
        maxQueueDepth: 5,
        queuePolicy: 'reject',
      })

      const state = queue.getState()
      expect(state.maxInFlight).toBe(2)
      expect(state.maxQueueDepth).toBe(5)
      expect(state.queuePolicy).toBe('reject')
      expect(state.inFlight).toBe(0)
      expect(state.pending).toBe(0)
      expect(state.blocked).toBe(0)
      expect(state.paused).toBe(false)
      expect(state.disposed).toBe(false)
    })
  })

  describe('pause and resume', () => {
    it('pause stops dispatching new items', async () => {
      const results: string[] = []
      const queue = new DispatchQueue<Payload>(
        async payload => {
          results.push(payload.id)
          return payload.id
        },
        { maxInFlight: 1, maxQueueDepth: 10, queuePolicy: 'block' }
      )

      queue.pause()
      queue.enqueue({ id: 'a' })
      queue.enqueue({ id: 'b' })
      await tick()

      expect(results).toEqual([])
      expect(queue.getState().pending).toBe(2)
      expect(queue.getState().paused).toBe(true)
    })

    it('resume processes queued items', async () => {
      const results: string[] = []
      const queue = new DispatchQueue<Payload>(
        async payload => {
          results.push(payload.id)
          return payload.id
        },
        { maxInFlight: 10, maxQueueDepth: 10, queuePolicy: 'block' }
      )

      queue.pause()
      queue.enqueue({ id: 'a' })
      queue.enqueue({ id: 'b' })
      await tick()

      queue.resume()
      await tick()

      expect(results).toEqual(['a', 'b'])
    })
  })

  describe('dispose', () => {
    it('rejects all pending and in-flight items', async () => {
      const gate = deferred<string>()
      const queue = new DispatchQueue<Payload>(async () => gate.promise, {
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      const inFlight = queue.enqueue({ id: 'in-flight' })
      const pending = queue.enqueue({ id: 'pending' })
      await tick()

      queue.dispose()

      await expect(inFlight).rejects.toMatchObject({ name: 'TaskDisposedError' })
      await expect(pending).rejects.toMatchObject({ name: 'TaskDisposedError' })
    })

    it('rejects new enqueues after dispose', async () => {
      const queue = new DispatchQueue<Payload>(async () => 'ok', {
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      queue.dispose()

      const rejected = queue.enqueue({ id: 'new' })
      await expect(rejected).rejects.toMatchObject({ name: 'TaskDisposedError' })
    })
  })

  describe('isIdle', () => {
    it('returns true when queue is empty', () => {
      const queue = new DispatchQueue<Payload>(async () => 'ok', {
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      expect(queue.isIdle()).toBe(true)
    })

    it('returns false when items are in flight', async () => {
      const gate = deferred<string>()
      const queue = new DispatchQueue<Payload>(async () => gate.promise, {
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      queue.enqueue({ id: 'a' })
      await tick()

      expect(queue.isIdle()).toBe(false)

      gate.resolve('done')
    })
  })

  describe('cancellation', () => {
    it('rejects a queued entry when its signal aborts', async () => {
      const gate = deferred<void>()
      const queue = new DispatchQueue<Payload>(
        async () => {
          await gate.promise
          return 'ok'
        },
        { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'block' }
      )

      const first = queue.enqueue({ id: 'first' })

      const controller = new AbortController()
      const second = queue.enqueue({ id: 'second' }, { signal: controller.signal })
      controller.abort()

      await expect(second).rejects.toMatchObject({ name: 'AbortError' })

      gate.resolve()
      await first
    })

    it('rejects an in-flight entry when its signal aborts', async () => {
      const gate = deferred<void>()
      const queue = new DispatchQueue<Payload>(
        async () => {
          await gate.promise
          return 'ok'
        },
        { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'block' }
      )

      const controller = new AbortController()
      const promise = queue.enqueue({ id: 'only' }, { signal: controller.signal })

      await tick()
      controller.abort()

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

      gate.resolve()
    })

    it('rejects immediately if signal is already aborted', async () => {
      const queue = new DispatchQueue<Payload>(async () => 'ok', {
        maxInFlight: 1,
        maxQueueDepth: 10,
        queuePolicy: 'block',
      })

      const controller = new AbortController()
      controller.abort()

      const promise = queue.enqueue({ id: 'a' }, { signal: controller.signal })
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    })
  })

  describe('hooks', () => {
    it('calls onQueued when item is added to pending queue', async () => {
      const onQueued = vi.fn()
      const queue = new DispatchQueue<Payload>(
        async () => 'ok',
        { maxInFlight: 10, maxQueueDepth: 10, queuePolicy: 'block' },
        { onQueued }
      )

      queue.enqueue({ id: 'a' })
      await tick()

      expect(onQueued).toHaveBeenCalledWith({ id: 'a' }, 1, 10)
    })

    it('calls onDispatch when item starts processing', async () => {
      const onDispatch = vi.fn()
      const queue = new DispatchQueue<Payload>(
        async () => 'ok',
        { maxInFlight: 10, maxQueueDepth: 10, queuePolicy: 'block' },
        { onDispatch }
      )

      queue.enqueue({ id: 'a' })
      await tick()

      expect(onDispatch).toHaveBeenCalledWith({ id: 'a' }, expect.any(Number))
    })

    it('calls onBlocked when item is blocked', async () => {
      const gate = deferred<string>()
      const onBlocked = vi.fn()
      const queue = new DispatchQueue<Payload>(
        async () => gate.promise,
        { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'block' },
        { onBlocked }
      )

      queue.enqueue({ id: 'in-flight' })
      queue.enqueue({ id: 'pending' })
      queue.enqueue({ id: 'blocked' })
      await tick()

      expect(onBlocked).toHaveBeenCalledWith({ id: 'blocked' }, 1, 1)

      gate.resolve('done')
    })

    it('calls onReject when item is dropped', async () => {
      const gate = deferred<string>()
      const onReject = vi.fn()
      const queue = new DispatchQueue<Payload>(
        async () => gate.promise,
        { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'reject' },
        { onReject }
      )

      queue.enqueue({ id: 'in-flight' })
      queue.enqueue({ id: 'pending' })
      queue.enqueue({ id: 'overflow' }).catch(() => {})
      await tick()

      expect(onReject).toHaveBeenCalledWith({ id: 'overflow' }, expect.any(Error))

      gate.resolve('done')
    })

    it('calls onCancel when item is aborted', async () => {
      const gate = deferred<string>()
      const onCancel = vi.fn()
      const queue = new DispatchQueue<Payload>(
        async () => gate.promise,
        { maxInFlight: 1, maxQueueDepth: 10, queuePolicy: 'block' },
        { onCancel }
      )

      queue.enqueue({ id: 'in-flight' })

      const controller = new AbortController()
      queue.enqueue({ id: 'pending' }, { signal: controller.signal }).catch(() => {})
      await tick()

      controller.abort()
      await tick()

      expect(onCancel).toHaveBeenCalledWith({ id: 'pending' }, 'queued')

      gate.resolve('done')
    })
  })
})
