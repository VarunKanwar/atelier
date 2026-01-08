import { describe, expect, it } from 'vitest'
import { createTaskWorker, type TaskContext } from '../core/task-worker'

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })

describe('createTaskWorker cancellation', () => {
  it('aborts the in-flight handler when __cancel is called', async () => {
    const handlers = {
      async run(ctx: TaskContext) {
        await waitForAbort(ctx.signal)
        ctx.throwIfAborted()
        return 'done'
      },
    }
    const worker = createTaskWorker(handlers)

    const promise = worker.__dispatch('call-1', 'run', [])
    worker.__cancel('call-1')

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('ignores cancellation for unknown call ids', () => {
    const handlers = {
      async noop(_ctx: TaskContext) {
        return 'ok'
      },
    }
    const worker = createTaskWorker(handlers)

    expect(() => worker.__cancel('missing')).not.toThrow()
  })
})
