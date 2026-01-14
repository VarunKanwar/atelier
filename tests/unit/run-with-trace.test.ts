import { describe, expect, it } from 'vitest'

import { createTaskRuntime } from '../../src/runtime'
import type { RuntimeEvent } from '../../src/types'

const getTraceEvents = (events: RuntimeEvent[]) => events.filter(event => event.kind === 'trace')

const makeAbortError = () => {
  const error = new Error('aborted')
  ;(error as Error & { name?: string }).name = 'AbortError'
  return error
}

describe('runWithTrace', () => {
  it('emits a trace event with ok status on success', async () => {
    const runtime = createTaskRuntime({ observability: { spans: 'on' } })
    const events: RuntimeEvent[] = []
    runtime.subscribeEvents(event => events.push(event))

    await runtime.runWithTrace('trace-success', async () => {
      return 'ok'
    })

    const traceEvents = getTraceEvents(events)
    expect(traceEvents.length).toBe(1)
    expect(traceEvents[0].status).toBe('ok')
    expect(traceEvents[0].traceName).toBe('trace-success')
    expect(traceEvents[0].durationMs ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('emits a trace event with canceled status on AbortError', async () => {
    const runtime = createTaskRuntime({ observability: { spans: 'on' } })
    const events: RuntimeEvent[] = []
    runtime.subscribeEvents(event => events.push(event))

    await expect(
      runtime.runWithTrace('trace-canceled', async () => {
        throw makeAbortError()
      })
    ).rejects.toThrow('aborted')

    const traceEvents = getTraceEvents(events)
    expect(traceEvents.length).toBe(1)
    expect(traceEvents[0].status).toBe('canceled')
  })
})
