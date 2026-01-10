import { describe, expect, it } from 'vitest'
import { createAbortTaskController } from '../../core/abort-task-controller'
import { parallelLimit, yieldAsCompleted } from '../../core/parallel-limit'
import { deferred } from '../helpers/deferred'

describe('parallelLimit', () => {
  describe('concurrency limiting', () => {
    it('limits concurrency', async () => {
      const items = [1, 2, 3, 4]
      const gates = items.map(() => deferred<void>())
      let inFlight = 0
      let maxInFlight = 0

      const results: number[] = []
      const run = async () => {
        for await (const value of parallelLimit(items, 2, async item => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await gates[item - 1].promise
          inFlight -= 1
          return item
        })) {
          results.push(value)
        }
      }

      const runner = run()
      await Promise.resolve()
      expect(maxInFlight).toBeLessThanOrEqual(2)

      for (const gate of gates) {
        gate.resolve()
      }
      await runner

      expect(results.sort()).toEqual([1, 2, 3, 4])
    })

    it('throws for invalid limit', async () => {
      const run = async () => {
        for await (const _ of parallelLimit([1], 0, async x => x)) {
          // Should not reach here
        }
      }
      await expect(run()).rejects.toThrow('parallelLimit requires a limit of at least 1')
    })
  })

  describe('error handling', () => {
    it('fail-fast: throws on first error by default', async () => {
      const items = [1, 2, 3]
      const results: number[] = []

      const run = async () => {
        for await (const value of parallelLimit(items, 1, async item => {
          if (item === 2) throw new Error('boom')
          return item
        })) {
          results.push(value)
        }
      }

      await expect(run()).rejects.toThrow('boom')
      expect(results).toEqual([1])
    })

    it('continue: skips errors and continues processing', async () => {
      const items = [1, 2, 3]
      const results: number[] = []

      for await (const value of parallelLimit(
        items,
        1,
        async item => {
          if (item === 2) throw new Error('boom')
          return item
        },
        { errorPolicy: 'continue' }
      )) {
        results.push(value)
      }

      expect(results).toEqual([1, 3])
    })

    it('onError callback is called for errors', async () => {
      const items = [1, 2, 3]
      const errors: Array<{ error: unknown; item: number }> = []

      for await (const _ of parallelLimit(
        items,
        1,
        async item => {
          if (item === 2) throw new Error('boom')
          return item
        },
        {
          errorPolicy: 'continue',
          onError: (error, item) => errors.push({ error, item }),
        }
      )) {
        // collect
      }

      expect(errors).toHaveLength(1)
      expect(errors[0].item).toBe(2)
      expect((errors[0].error as Error).message).toBe('boom')
    })
  })

  describe('returnSettled mode', () => {
    it('yields settled results with status', async () => {
      const items = [1, 2, 3]
      const results: Array<{ status: string; item: number }> = []

      for await (const result of parallelLimit(
        items,
        1,
        async item => {
          if (item === 2) throw new Error('boom')
          return item * 10
        },
        { returnSettled: true }
      )) {
        results.push({ status: result.status, item: result.item })
      }

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual({ status: 'fulfilled', item: 1 })
      expect(results[1]).toEqual({ status: 'rejected', item: 2 })
      expect(results[2]).toEqual({ status: 'fulfilled', item: 3 })
    })

    it('includes value for fulfilled results', async () => {
      const items = [1, 2]
      const results = []

      for await (const result of parallelLimit(items, 2, async item => item * 10, {
        returnSettled: true,
      })) {
        results.push(result)
      }

      expect(results).toContainEqual({ status: 'fulfilled', value: 10, item: 1 })
      expect(results).toContainEqual({ status: 'fulfilled', value: 20, item: 2 })
    })

    it('includes error for rejected results', async () => {
      const items = [1]
      const results: Array<{ status: string; error?: unknown; value?: unknown }> = []
      const error = new Error('test error')

      for await (const result of parallelLimit(
        items,
        1,
        async () => {
          throw error
        },
        { returnSettled: true }
      )) {
        results.push(result)
      }

      expect(results).toHaveLength(1)
      expect(results[0].status).toBe('rejected')
      if (results[0].status === 'rejected') {
        expect(results[0].error).toBe(error)
      }
    })
  })

  describe('cancellation', () => {
    it('skips items whose keys are already aborted', async () => {
      const controller = createAbortTaskController()
      controller.abort('b')

      const items = ['a', 'b', 'c']
      const results: string[] = []

      for await (const value of parallelLimit(items, 2, async item => item, {
        abortTaskController: controller,
        keyOf: item => item,
      })) {
        results.push(value)
      }

      expect(results.sort()).toEqual(['a', 'c'])
    })

    it('drops results for keys aborted before yield', async () => {
      const controller = createAbortTaskController()
      const items = ['a', 'b']
      const results: string[] = []

      for await (const value of parallelLimit(
        items,
        2,
        async item => {
          if (item === 'a') {
            controller.abort('a')
          }
          return item
        },
        {
          abortTaskController: controller,
          keyOf: item => item,
        }
      )) {
        results.push(value)
      }

      expect(results).toEqual(['b'])
    })

    it('skips AbortError rejections when cancellation is enabled', async () => {
      const controller = createAbortTaskController()
      const items = [1]
      const results: number[] = []

      for await (const value of parallelLimit(
        items,
        1,
        async () => {
          const error = new Error('aborted')
          ;(error as Error & { name?: string }).name = 'AbortError'
          throw error
        },
        {
          abortTaskController: controller,
          keyOf: () => 'a',
        }
      )) {
        results.push(value)
      }

      expect(results).toEqual([])
    })

    it('stops processing when signal is aborted', async () => {
      const controller = new AbortController()
      const items = [1, 2, 3, 4, 5]
      const processed: number[] = []
      const results: number[] = []

      const gates = items.map(() => deferred<number>())

      const run = async () => {
        for await (const value of parallelLimit(
          items,
          2,
          async item => {
            processed.push(item)
            return gates[item - 1].promise
          },
          { signal: controller.signal }
        )) {
          results.push(value)
        }
      }

      const runner = run()
      await Promise.resolve()
      await Promise.resolve()

      // First 2 items should be in flight
      expect(processed.length).toBe(2)

      // Abort and resolve remaining
      controller.abort()
      for (const gate of gates) {
        gate.resolve(0)
      }

      await runner

      // No more items should have been started after abort
      expect(processed.length).toBe(2)
    })
  })
})

describe('yieldAsCompleted', () => {
  it('yields promises in completion order', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()]
    const promises = gates.map(g => g.promise)
    const results: string[] = []

    const run = async () => {
      for await (const value of yieldAsCompleted(promises)) {
        results.push(value)
      }
    }

    const runner = run()
    await Promise.resolve()

    // Resolve in reverse order
    gates[2].resolve('c')
    await Promise.resolve()
    gates[0].resolve('a')
    await Promise.resolve()
    gates[1].resolve('b')
    await runner

    expect(results).toEqual(['c', 'a', 'b'])
  })

  it('handles empty array', async () => {
    const results: unknown[] = []

    for await (const value of yieldAsCompleted([])) {
      results.push(value)
    }

    expect(results).toEqual([])
  })

  it('handles single promise', async () => {
    const results: number[] = []

    for await (const value of yieldAsCompleted([Promise.resolve(42)])) {
      results.push(value)
    }

    expect(results).toEqual([42])
  })

  it('handles already resolved promises', async () => {
    const results: number[] = []

    for await (const value of yieldAsCompleted([
      Promise.resolve(1),
      Promise.resolve(2),
      Promise.resolve(3),
    ])) {
      results.push(value)
    }

    expect(results.sort()).toEqual([1, 2, 3])
  })
})
