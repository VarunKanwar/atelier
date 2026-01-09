import { describe, expect, it } from 'vitest'
import { createTelemetryStore } from '../../core/telemetry'
import type { TaskEvent } from '../../core/types'

const makeEvent = (overrides: Partial<TaskEvent> & { taskId: string; type: TaskEvent['type'] }): TaskEvent => ({
  ts: Date.now(),
  ...overrides,
})

describe('TelemetryStore', () => {
  describe('basic event counting', () => {
    it('tracks success count', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: 100 }))

      const state = store.getState()
      expect(state.tasks['task-1'].success).toBe(1)
      expect(state.tasks['task-1'].failure).toBe(0)
    })

    it('tracks failure count', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'error', error: new Error('boom') }))

      const state = store.getState()
      expect(state.tasks['task-1'].failure).toBe(1)
      expect(state.tasks['task-1'].lastError).toBeInstanceOf(Error)
    })

    it('tracks rejected count', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'rejected' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'rejected' }))

      const state = store.getState()
      expect(state.tasks['task-1'].rejected).toBe(2)
    })

    it('tracks canceled count', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'canceled', canceledPhase: 'queued' }))

      const state = store.getState()
      expect(state.tasks['task-1'].canceled).toBe(1)
    })

    it('tracks totalDispatched', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))

      const state = store.getState()
      expect(state.tasks['task-1'].totalDispatched).toBe(3)
    })
  })

  describe('queue state tracking', () => {
    it('tracks pending queue depth', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'queued' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'queued' }))

      const state = store.getState()
      expect(state.tasks['task-1'].pending).toBe(2)
    })

    it('decrements pending on dispatch', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'queued' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'queued' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))

      const state = store.getState()
      expect(state.tasks['task-1'].pending).toBe(1)
      expect(state.tasks['task-1'].inFlight).toBe(1)
    })

    it('tracks blocked queue depth', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'blocked', blockedDepth: 3 }))

      const state = store.getState()
      expect(state.tasks['task-1'].blocked).toBe(3)
    })

    it('decrements pending on canceled with queued phase', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'queued' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'queued' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'canceled', canceledPhase: 'queued' }))

      const state = store.getState()
      expect(state.tasks['task-1'].pending).toBe(1)
    })
  })

  describe('in-flight tracking', () => {
    it('tracks inFlight count', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))

      const state = store.getState()
      expect(state.tasks['task-1'].inFlight).toBe(2)
    })

    it('decrements inFlight on success', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success' }))

      const state = store.getState()
      expect(state.tasks['task-1'].inFlight).toBe(1)
    })

    it('decrements inFlight on error', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'error' }))

      const state = store.getState()
      expect(state.tasks['task-1'].inFlight).toBe(0)
    })

    it('tracks inFlightByWorker', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch', workerIndex: 0 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch', workerIndex: 1 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch', workerIndex: 0 }))

      const state = store.getState()
      expect(state.tasks['task-1'].inFlightByWorker[0]).toBe(2)
      expect(state.tasks['task-1'].inFlightByWorker[1]).toBe(1)
    })
  })

  describe('latency metrics', () => {
    it('computes average duration', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: 100 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: 200 }))

      const state = store.getState()
      expect(state.tasks['task-1'].avgMs).toBe(150)
    })

    it('computes p50 and p95 durations', () => {
      const store = createTelemetryStore()

      // Emit 100 events with durations 1-100
      for (let i = 1; i <= 100; i++) {
        store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
        store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: i }))
      }

      const state = store.getState()
      expect(state.tasks['task-1'].p50Ms).toBe(50)
      expect(state.tasks['task-1'].p95Ms).toBe(95)
    })

    it('tracks lastDurationMs', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: 100 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: 250 }))

      const state = store.getState()
      expect(state.tasks['task-1'].lastDurationMs).toBe(250)
    })

    it('includes error durations in metrics', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: 100 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'error', durationMs: 200 }))

      const state = store.getState()
      expect(state.tasks['task-1'].avgMs).toBe(150)
    })
  })

  describe('queue wait metrics', () => {
    it('tracks queue wait times', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch', queueWaitMs: 50 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch', queueWaitMs: 150 }))

      const state = store.getState()
      expect(state.tasks['task-1'].avgQueueWaitMs).toBe(100)
      expect(state.tasks['task-1'].lastQueueWaitMs).toBe(150)
    })

    it('computes p50 and p95 queue wait times', () => {
      const store = createTelemetryStore()

      for (let i = 1; i <= 100; i++) {
        store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch', queueWaitMs: i }))
      }

      const state = store.getState()
      expect(state.tasks['task-1'].p50QueueWaitMs).toBe(50)
      expect(state.tasks['task-1'].p95QueueWaitMs).toBe(95)
    })
  })

  describe('worker lifecycle', () => {
    it('tracks worker spawns', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:spawn', workerIndex: 0 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:spawn', workerIndex: 1 }))

      const state = store.getState()
      expect(state.tasks['task-1'].activeWorkers).toBe(2)
      expect(state.tasks['task-1'].totalWorkersSpawned).toBe(2)
    })

    it('tracks worker terminations', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:spawn', workerIndex: 0 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:spawn', workerIndex: 1 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:terminate', workerIndex: 0 }))

      const state = store.getState()
      expect(state.tasks['task-1'].activeWorkers).toBe(1)
      expect(state.tasks['task-1'].totalWorkersSpawned).toBe(2)
    })

    it('tracks worker crashes', () => {
      const store = createTelemetryStore()
      const error = new Error('worker died')

      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:spawn', workerIndex: 0 }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'worker:crash', workerIndex: 0, error, ts: 12345 }))

      const state = store.getState()
      expect(state.tasks['task-1'].activeWorkers).toBe(0)
      expect(state.tasks['task-1'].lastCrash).toEqual({
        ts: 12345,
        error,
        workerIndex: 0,
      })
    })
  })

  describe('multiple tasks', () => {
    it('tracks metrics separately per task', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success' }))
      store.emit(makeEvent({ taskId: 'task-2', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-2', type: 'error' }))

      const state = store.getState()
      expect(state.tasks['task-1'].success).toBe(1)
      expect(state.tasks['task-1'].failure).toBe(0)
      expect(state.tasks['task-2'].success).toBe(0)
      expect(state.tasks['task-2'].failure).toBe(1)
    })

    it('preserves taskName when provided', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', taskName: 'My Task', type: 'dispatch' }))

      const state = store.getState()
      expect(state.tasks['task-1'].taskName).toBe('My Task')
    })
  })

  describe('reset', () => {
    it('clears all tracked state', () => {
      const store = createTelemetryStore()

      store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
      store.emit(makeEvent({ taskId: 'task-1', type: 'success' }))

      store.reset()

      const state = store.getState()
      expect(Object.keys(state.tasks)).toHaveLength(0)
    })
  })

  describe('maxSamples option', () => {
    it('limits duration samples to maxSamples', () => {
      const store = createTelemetryStore({ maxSamples: 5 })

      for (let i = 1; i <= 10; i++) {
        store.emit(makeEvent({ taskId: 'task-1', type: 'dispatch' }))
        store.emit(makeEvent({ taskId: 'task-1', type: 'success', durationMs: i * 10 }))
      }

      // p50 should be based on last 5 samples (60, 70, 80, 90, 100)
      const state = store.getState()
      expect(state.tasks['task-1'].p50Ms).toBe(80)
    })
  })
})
