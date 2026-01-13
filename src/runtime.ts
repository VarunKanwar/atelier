import { type AbortTaskController, createAbortTaskController } from './abort-task-controller'
import { createDefineTask, type Task } from './define-task'
import { classifyErrorKind, isAbortError, sampleById, stringifyError } from './observability-utils'
import type {
  InitMode,
  ObservabilityConfig,
  ObservabilityContext,
  RuntimeEvent,
  TaskConfig,
  TaskExecutor,
  TaskType,
  TraceContext,
  TraceEndOptions,
  WorkerState,
} from './types'

export type RuntimeTaskSnapshot = WorkerState & {
  taskId: string
  taskName?: string
  init: InitMode
}

export type RuntimeSnapshot = {
  tasks: RuntimeTaskSnapshot[]
}

export type RuntimeSnapshotSubscriptionOptions = {
  intervalMs?: number
  emitImmediately?: boolean
  onlyOnChange?: boolean
}

export type TaskRuntime = {
  // biome-ignore lint/suspicious/noExplicitAny: Generic default allows untyped task definitions
  defineTask: <T = any>(config: TaskConfig) => Task<T>
  abortTaskController: AbortTaskController
  getRuntimeSnapshot: () => RuntimeSnapshot
  subscribeRuntimeSnapshot: (
    listener: (snapshot: RuntimeSnapshot) => void,
    options?: RuntimeSnapshotSubscriptionOptions
  ) => () => void
  subscribeEvents: (listener: (event: RuntimeEvent) => void) => () => void
  createTrace: (name?: string) => TraceContext
  runWithTrace: <T>(name: string, fn: (trace: TraceContext) => Promise<T>) => Promise<T>
}

type RegisteredTask = {
  registryId: string
  taskId: string
  taskName?: string
  type: TaskType
  init: InitMode
  poolSize?: number
  executor: TaskExecutor
}

type RuntimeConfig = {
  observability?: ObservabilityConfig
}

const createRegistry = () => {
  const registry = new Map<string, RegisteredTask>()
  let registryCounter = 0

  const registerTask = (entry: Omit<RegisteredTask, 'registryId'>): (() => void) => {
    const registryId = `runtime-task-${registryCounter++}`
    registry.set(registryId, { registryId, ...entry })
    return () => {
      registry.delete(registryId)
    }
  }

  const getRuntimeSnapshot = (): RuntimeSnapshot => {
    const tasks: RuntimeTaskSnapshot[] = []
    for (const entry of registry.values()) {
      const state = entry.executor.getState()
      tasks.push({
        ...state,
        taskId: entry.taskId,
        taskName: entry.taskName,
        init: entry.init,
        poolSize: state.poolSize ?? entry.poolSize,
        type: entry.type,
      })
    }
    return { tasks }
  }

  const subscribeRuntimeSnapshot = (
    listener: (snapshot: RuntimeSnapshot) => void,
    options: RuntimeSnapshotSubscriptionOptions = {}
  ): (() => void) => {
    const intervalMs = options.intervalMs ?? 250
    const emitImmediately = options.emitImmediately ?? true
    const onlyOnChange = options.onlyOnChange ?? false
    let stopped = false
    let lastSnapshotJson: string | null = null

    const emit = () => {
      if (stopped) return
      const snapshot = getRuntimeSnapshot()
      if (onlyOnChange) {
        const json = JSON.stringify(snapshot)
        if (json === lastSnapshotJson) return
        lastSnapshotJson = json
      }
      listener(snapshot)
    }

    if (emitImmediately) {
      emit()
    }

    const intervalId = setInterval(emit, intervalMs)
    return () => {
      stopped = true
      clearInterval(intervalId)
    }
  }

  return { registerTask, getRuntimeSnapshot, subscribeRuntimeSnapshot }
}

export const createTaskRuntime = (config: RuntimeConfig = {}): TaskRuntime => {
  const registry = createRegistry()
  const abortTaskController = createAbortTaskController()
  const { observability } = config

  const eventListeners = new Set<(event: RuntimeEvent) => void>()
  const emitEvent = (event: RuntimeEvent) => {
    if (eventListeners.size === 0) return
    for (const listener of eventListeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  const now = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now()
    }
    return Date.now()
  }

  const emitMeasure = (name: string, start: number, end: number, detail?: object) => {
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
    performance.measure(name, { start, end, detail })
  }

  const resolveSpanMode = (spans?: ObservabilityConfig['spans']): 'on' | 'off' => {
    const defaultMode: ObservabilityConfig['spans'] = 'auto'
    const effective = spans ?? defaultMode
    if (typeof effective === 'string') {
      if (effective === 'on') return 'on'
      if (effective === 'off') return 'off'
      return isDevEnvironment() ? 'on' : 'off'
    }
    const mode = effective.mode ?? 'on'
    if (mode === 'on') return 'on'
    if (mode === 'off') return 'off'
    return isDevEnvironment() ? 'on' : 'off'
  }

  const resolveSampleRate = (spans?: ObservabilityConfig['spans']): number => {
    if (!spans || typeof spans === 'string') return 1
    const rate = spans.sampleRate ?? 1
    if (!Number.isFinite(rate)) return 1
    return Math.max(0, Math.min(1, rate))
  }

  const spansEnabled = resolveSpanMode(observability?.spans) === 'on'
  const sampleRate = resolveSampleRate(observability?.spans)

  const shouldSampleSpan = (trace: TraceContext | undefined, spanId: string): boolean => {
    if (!spansEnabled) return false
    if (trace) return trace.sampled
    if (sampleRate >= 1) return true
    if (sampleRate <= 0) return false
    return sampleById(spanId, sampleRate)
  }

  const observabilityContext: ObservabilityContext = {
    spansEnabled,
    sampleRate,
    now,
    emitEvent,
    emitMeasure,
    shouldSampleSpan,
  }

  const defineTask = createDefineTask({
    registerTask: registry.registerTask,
    abortTaskController,
    observability: observabilityContext,
  })

  const createTrace = (name?: string): TraceContext => {
    const id = createTraceId()
    const sampled = spansEnabled && sampleRate > 0 && sampleById(id, sampleRate)
    const startTime = now()
    let ended = false

    const end = (options: TraceEndOptions = {}) => {
      if (ended) return
      ended = true
      if (!spansEnabled || !sampled) return

      const status = options.status ?? (options.error ? 'error' : 'ok')
      const errorKind = options.error ? classifyErrorKind(options.error) : undefined
      const error = options.error ? stringifyError(options.error) : undefined
      const endTime = now()

      emitMeasure('atelier:trace', startTime, endTime, {
        traceId: id,
        traceName: name,
        status,
        errorKind,
        error,
      })

      emitEvent({
        kind: 'trace',
        name: 'atelier:trace',
        ts: Date.now(),
        traceId: id,
        traceName: name,
        durationMs: endTime - startTime,
        status,
        errorKind,
        error,
      })
    }

    return { id, name, sampled, end }
  }

  const runWithTrace = async <T>(
    name: string,
    fn: (trace: TraceContext) => Promise<T>
  ): Promise<T> => {
    const trace = createTrace(name)
    try {
      const result = await fn(trace)
      trace.end({ status: 'ok' })
      return result
    } catch (error) {
      const status = isAbortError(error) ? 'canceled' : 'error'
      trace.end({ status, error })
      throw error
    }
  }

  return {
    defineTask,
    abortTaskController,
    getRuntimeSnapshot: registry.getRuntimeSnapshot,
    subscribeRuntimeSnapshot: registry.subscribeRuntimeSnapshot,
    subscribeEvents: listener => {
      eventListeners.add(listener)
      return () => {
        eventListeners.delete(listener)
      }
    },
    createTrace,
    runWithTrace,
  }
}

const isDevEnvironment = () => {
  if (typeof import.meta !== 'undefined') {
    const env = (import.meta as { env?: { DEV?: boolean } }).env
    if (typeof env?.DEV === 'boolean') {
      return env.DEV
    }
  }
  if (typeof process !== 'undefined') {
    const env = (process as { env?: { NODE_ENV?: string } }).env
    if (env?.NODE_ENV) {
      return env.NODE_ENV !== 'production'
    }
  }
  return false
}

const createTraceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `trace-${Math.random().toString(36).slice(2)}`
}
