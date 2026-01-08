import { describe, expect, it } from 'vitest'
import { parallelLimit } from '../core/parallel-limit'
import { createAbortTaskController } from '../core/abort-task-controller'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('parallelLimit', () => {
  it('limits concurrency', async () => {
    const items = [1, 2, 3, 4]
    const gates = items.map(() => deferred<void>())
    let inFlight = 0
    let maxInFlight = 0

    const results: number[] = []
    const run = async () => {
      for await (const value of parallelLimit(items, 2, async (item) => {
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

  it('skips items whose keys are already aborted', async () => {
    const controller = createAbortTaskController()
    controller.abort('b')

    const items = ['a', 'b', 'c']
    const results: string[] = []

    for await (const value of parallelLimit(items, 2, async (item) => item, {
      abortTaskController: controller,
      keyOf: (item) => item,
    })) {
      results.push(value)
    }

    expect(results.sort()).toEqual(['a', 'c'])
  })

  it('drops results for keys aborted before yield', async () => {
    const controller = createAbortTaskController()
    const items = ['a', 'b']
    const results: string[] = []

    for await (const value of parallelLimit(items, 2, async (item) => {
      if (item === 'a') {
        controller.abort('a')
      }
      return item
    }, {
      abortTaskController: controller,
      keyOf: (item) => item,
    })) {
      results.push(value)
    }

    expect(results).toEqual(['b'])
  })

  it('skips AbortError rejections when cancellation is enabled', async () => {
    const controller = createAbortTaskController()
    const items = [1]
    const results: number[] = []

    for await (const value of parallelLimit(items, 1, async () => {
      const error = new Error('aborted')
      ;(error as Error & { name?: string }).name = 'AbortError'
      throw error
    }, {
      abortTaskController: controller,
      keyOf: () => 'a',
    })) {
      results.push(value)
    }

    expect(results).toEqual([])
  })
})
