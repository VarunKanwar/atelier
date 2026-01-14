import { PerformanceObserver } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
  transfer: (obj: unknown) => obj,
}))

import { createTaskRuntime } from '../../src/runtime'
import { type DispatchHandler, FakeWorker } from '../helpers/fake-worker'

type TestAPI = {
  process: (value: string) => Promise<string>
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

const observeMeasures = (): (() => void) => {
  if (
    typeof performance === 'undefined' ||
    typeof performance.clearMeasures !== 'function' ||
    typeof PerformanceObserver === 'undefined'
  ) {
    return () => {}
  }

  const observer = new PerformanceObserver(() => {
    performance.clearMeasures('atelier:span')
    performance.clearMeasures('atelier:trace')
  })
  observer.observe({ entryTypes: ['measure'] })

  return () => {
    observer.disconnect()
    performance.clearMeasures('atelier:span')
    performance.clearMeasures('atelier:trace')
  }
}

const busyWork = (ms: number) => {
  const start = now()
  while (now() - start < ms) {
    // Intentional spin to simulate small CPU work.
  }
}

const makeWorkerFactory = (workMs: number) => {
  const dispatch: DispatchHandler = async (_callId, _method, args) => {
    busyWork(workMs)
    return args[0]
  }
  return () => new FakeWorker(dispatch) as unknown as Worker
}

const runIterations = async (task: TestAPI, iterations: number) => {
  for (let i = 0; i < iterations; i++) {
    await task.process('x')
  }
}

const measureDuration = async (task: TestAPI, iterations: number): Promise<number> => {
  const start = now()
  await runIterations(task, iterations)
  return now() - start
}

const measureBestOf = async (task: TestAPI, iterations: number, runs: number): Promise<number> => {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const duration = await measureDuration(task, iterations)
    if (duration < best) best = duration
  }
  return best
}

const warmup = async (task: TestAPI) => {
  await runIterations(task, 100)
}

const measureScenario = async (
  config: Parameters<typeof createTaskRuntime>[0],
  options: {
    subscribe: boolean
    iterations: number
    observeMeasures?: boolean
    workMs: number
  }
) => {
  const runtime = createTaskRuntime(config)
  const task = runtime.defineTask<TestAPI>({
    type: 'singleton',
    worker: makeWorkerFactory(options.workMs),
    taskId: 'perf-test-task',
  })

  const stopObserving = options.observeMeasures ? observeMeasures() : () => {}

  let eventCount = 0
  const unsubscribe = options.subscribe
    ? runtime.subscribeEvents(() => {
        eventCount += 1
      })
    : () => {}

  await warmup(task)
  const duration = await measureBestOf(task, options.iterations, 2)

  unsubscribe()
  stopObserving()
  task.dispose()

  return { duration, eventCount }
}

const pickIterations = async (workMs: number): Promise<number> => {
  const runtime = createTaskRuntime({ observability: { spans: 'off' } })
  const task = runtime.defineTask<TestAPI>({
    type: 'singleton',
    worker: makeWorkerFactory(workMs),
    taskId: 'perf-baseline-task',
  })

  await warmup(task)

  const targetMs = 200
  let iterations = 1000
  let duration = 0
  while (iterations <= 200_000) {
    duration = await measureBestOf(task, iterations, 2)
    if (duration >= targetMs) break
    iterations *= 2
  }

  task.dispose()

  return iterations
}

describe('observability overhead', () => {
  it('keeps telemetry overhead within a reasonable budget', async () => {
    const workMs = 0.2
    const iterations = await pickIterations(workMs)

    const baseline = await measureScenario(
      { observability: { spans: 'off' } },
      { subscribe: false, iterations, workMs }
    )

    const spansOnly = await measureScenario(
      { observability: { spans: { mode: 'on', sampleRate: 1 } } },
      { subscribe: false, iterations, observeMeasures: true, workMs }
    )

    const withEvents = await measureScenario(
      { observability: { spans: { mode: 'on', sampleRate: 1 } } },
      { subscribe: true, iterations, observeMeasures: true, workMs }
    )

    const spansRatio = spansOnly.duration / baseline.duration
    const eventsRatio = withEvents.duration / baseline.duration

    expect(spansRatio).toBeLessThan(1.2)
    expect(eventsRatio).toBeLessThan(1.5)
  })
})
