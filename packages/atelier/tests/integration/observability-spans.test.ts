import { describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
  transfer: (obj: unknown) => obj,
}))

import { createTaskRuntime } from '../../src/runtime'
import type { RuntimeEvent } from '../../src/types'
import { type DispatchHandler, FakeWorker } from '../helpers/fake-worker'

type TestAPI = {
  process: (value: string) => Promise<string>
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

describe('observability spans', () => {
  it('emits a span event for successful task calls', async () => {
    const runtime = createTaskRuntime({ observability: { spans: 'on' } })
    const events: RuntimeEvent[] = []
    runtime.subscribeEvents(event => events.push(event))

    const { createWorker } = makeWorkerFactory([
      async (_callId, _method, args) => {
        return args[0]
      },
    ])

    const task = runtime.defineTask<TestAPI>({
      type: 'singleton',
      worker: createWorker,
      taskId: 'task-span-test',
    })

    const result = await task.process('hello')
    expect(result).toBe('hello')

    const spanEvents = events.filter(event => event.kind === 'span')
    expect(spanEvents.length).toBe(1)
    const span = spanEvents[0]
    expect(span.status).toBe('ok')
    expect(span.taskId).toBe('task-span-test')
    expect(span.durationMs ?? 0).toBeGreaterThanOrEqual(0)
  })
})
