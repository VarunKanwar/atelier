import { describe, expect, it } from 'vitest'
import { DispatchQueue } from '../core/dispatch-queue'

type Payload = { id: string }

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => Promise.resolve()

describe('DispatchQueue cancellation', () => {
  it('rejects a queued entry when its signal aborts', async () => {
    const gate = deferred<void>()
    const queue = new DispatchQueue<Payload>(
      async () => {
        await gate.promise
        return 'ok'
      },
      { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'block' },
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
      { maxInFlight: 1, maxQueueDepth: 1, queuePolicy: 'block' },
    )

    const controller = new AbortController()
    const promise = queue.enqueue({ id: 'only' }, { signal: controller.signal })

    await tick()
    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    gate.resolve()
  })
})
