/**
 * defineTask - Factory function to create task dispatchers
 * Returns a Proxy that dispatches method calls to workers
 */

import type { Remote } from 'comlink'
import type { AbortTaskController } from './abort-task-controller'
import { SingletonWorker } from './singleton-worker'
import type {
  InitMode,
  ObservabilityContext,
  TaskConfig,
  TaskDispatchOptions,
  TaskExecutor,
} from './types'
import { WorkerPool } from './worker-pool'

export type Task<T> = Remote<T> & {
  // Add internal properties for observability
  __executor: TaskExecutor
  __config: TaskConfig
  with: (options: TaskDispatchOptions) => Task<T>
  getState(): ReturnType<TaskExecutor['getState']>
  startWorkers(): void
  stopWorkers(): void
  dispose(): void
}

export type DefineTaskContext = {
  registerTask: (entry: {
    taskId: string
    taskName?: string
    type: TaskConfig['type']
    init: InitMode
    poolSize?: number
    executor: TaskExecutor
  }) => () => void
  abortTaskController: AbortTaskController
  observability: ObservabilityContext
}

/**
 * Define a task that runs in a worker
 *
 * @example
 * ```typescript
 * import { createTaskRuntime } from './core'
 *
 * type ResizeAPI = {
 *   process: (image: ImageData) => Promise<ImageData>
 * }
 *
 * const runtime = createTaskRuntime()
 * const resize = runtime.defineTask<ResizeAPI>({
 *   type: 'parallel',
 *   worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
 *   poolSize: 8,
 *   init: 'lazy'
 * })
 *
 * const result = await resize.process(image)
 * ```
 */
export function createDefineTask(context: DefineTaskContext) {
  // biome-ignore lint/suspicious/noExplicitAny: Generic default allows untyped task definitions
  return function defineTask<T = any>(config: TaskConfig): Task<T> {
    const {
      type,
      worker: createWorker,
      init = 'lazy',
      poolSize: providedPoolSize,
      taskName,
      taskId,
      maxInFlight,
      maxQueueDepth,
      queuePolicy,
      idleTimeoutMs,
      keyOf,
      timeoutMs,
      crashPolicy,
      crashMaxRetries,
    } = config

    const poolSize = providedPoolSize ?? getDefaultPoolSize()

    // Stable ID for observability; auto-generated if not provided.
    const resolvedTaskId = taskId ?? `task-${globalTaskId++}`
    // Executor-level backpressure defaults:
    // - parallel: allow poolSize in-flight
    // - singleton: serialize with 1 in-flight
    const resolvedMaxQueueDepth = maxQueueDepth ?? Number.POSITIVE_INFINITY
    const resolvedMaxInFlight = maxInFlight ?? (type === 'parallel' ? poolSize : 1)
    const resolvedQueuePolicy = queuePolicy ?? 'block'

    // Create executor based on task type
    const executor: TaskExecutor =
      type === 'parallel'
        ? new WorkerPool<T>(
            createWorker,
            poolSize,
            init,
            context.observability,
            resolvedTaskId,
            taskName,
            resolvedMaxInFlight,
            resolvedMaxQueueDepth,
            resolvedQueuePolicy,
            crashPolicy,
            crashMaxRetries,
            idleTimeoutMs
          )
        : new SingletonWorker<T>(
            createWorker,
            init,
            context.observability,
            resolvedTaskId,
            taskName,
            resolvedMaxInFlight,
            resolvedMaxQueueDepth,
            resolvedQueuePolicy,
            crashPolicy,
            crashMaxRetries,
            idleTimeoutMs
          )

    let disposed = false
    let unregister: (() => void) | null = context.registerTask({
      taskId: resolvedTaskId,
      taskName,
      type,
      init,
      poolSize: type === 'parallel' ? poolSize : undefined,
      executor,
    })

    const disposeTask = () => {
      try {
        executor.dispose()
      } finally {
        disposed = true
        unregister?.()
        unregister = null
      }
    }

    const buildDispatchEnvelope = (
      args: unknown[],
      baseOptions?: TaskDispatchOptions
    ): { options: TaskDispatchOptions; cleanup?: () => void } => {
      const resolvedKey = resolveKey(keyOf, args)
      const keySignal = resolvedKey ? context.abortTaskController.signalFor(resolvedKey) : undefined
      const { signal, cleanup } = buildDispatchSignal(keySignal, timeoutMs)
      const options: TaskDispatchOptions = {
        ...(signal || resolvedKey ? { signal, key: resolvedKey } : {}),
        ...(baseOptions ?? {}),
      }
      return { options, cleanup }
    }

    const createMethodInvoker = (method: string, baseOptions?: TaskDispatchOptions) => {
      // biome-ignore lint/suspicious/noExplicitAny: Proxy handler intercepts arbitrary method calls
      return (...args: any[]) => {
        if (disposed) {
          return Promise.reject(createDisposedError())
        }

        const { options, cleanup } = buildDispatchEnvelope(args, baseOptions)

        let dispatchPromise: Promise<unknown>
        try {
          dispatchPromise = executor.dispatch(method, args, options)
        } catch (error) {
          cleanup?.()
          return Promise.reject(error)
        }

        if (!cleanup) {
          return dispatchPromise
        }

        return dispatchPromise.finally(() => {
          cleanup()
        })
      }
    }

    const resolveProxyProperty = (
      prop: string | symbol,
      baseOptions?: TaskDispatchOptions
    ): unknown => {
      // Expose internal executor for debugging
      if (prop === '__executor') {
        return executor
      }

      // Expose config for debugging
      if (prop === '__config') {
        return config
      }

      if (prop === 'with') {
        return (options: TaskDispatchOptions) =>
          createTaskProxy(mergeDispatchOptions(baseOptions, options))
      }

      // Expose state getter
      if (prop === 'getState') {
        return () => executor.getState()
      }

      if (prop === 'startWorkers') {
        return () => executor.startWorkers()
      }

      if (prop === 'stopWorkers') {
        return () => executor.stopWorkers()
      }

      // Expose dispose method
      if (prop === 'dispose') {
        return disposeTask
      }

      // All other properties are assumed to be worker methods.
      if (typeof prop === 'string') {
        return createMethodInvoker(prop, baseOptions)
      }

      return undefined
    }

    const createTaskProxy = (baseOptions?: TaskDispatchOptions): Task<T> => {
      // Create a proxy that intercepts method calls and forwards to the executor.
      const proxy = new Proxy({} as Task<T>, {
        get(_target, prop: string | symbol) {
          // Avoid thenable behavior when tasks are passed to Promise resolution.
          if (prop === 'then') {
            return undefined
          }
          return resolveProxyProperty(prop, baseOptions)
        },
      })

      return proxy
    }

    return createTaskProxy()
  }
}

let globalTaskId = 1

const createDisposedError = () => {
  const error = new Error('Task was disposed')
  ;(error as Error & { name?: string }).name = 'TaskDisposedError'
  return error
}

const mergeDispatchOptions = (
  base?: TaskDispatchOptions,
  next?: TaskDispatchOptions
): TaskDispatchOptions | undefined => {
  if (!base && !next) return undefined
  if (!base) return next
  if (!next) return base
  return { ...base, ...next }
}

const resolveKey = (
  keyOf: TaskConfig['keyOf'] | undefined,
  args: unknown[]
): string | undefined => {
  if (!keyOf) return undefined
  const key = keyOf(...args)
  if (typeof key !== 'string') return undefined
  if (key.length === 0) return undefined
  return key
}

const getDefaultPoolSize = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
    if (navigator.hardwareConcurrency > 0) {
      return navigator.hardwareConcurrency
    }
  }
  return 4
}

const buildDispatchSignal = (
  keySignal: AbortSignal | undefined,
  timeoutMs?: number
): { signal?: AbortSignal; cleanup?: () => void } => {
  const timeout = createTimeoutSignal(timeoutMs)
  const signals = [keySignal, timeout.signal].filter(Boolean) as AbortSignal[]
  if (signals.length === 0) {
    return { signal: undefined, cleanup: timeout.cleanup }
  }
  if (signals.length === 1) {
    return { signal: signals[0], cleanup: timeout.cleanup }
  }
  const composed = composeSignals(signals)
  const cleanup = () => {
    composed.cleanup?.()
    timeout.cleanup?.()
  }
  return { signal: composed.signal, cleanup }
}

const createTimeoutSignal = (
  timeoutMs?: number
): { signal?: AbortSignal; cleanup?: () => void } => {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {}
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId)
    },
  }
}

const composeSignals = (signals: AbortSignal[]): { signal: AbortSignal; cleanup?: () => void } => {
  if (signals.length === 1) return { signal: signals[0] }
  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal })
    .any
  if (typeof anySignal === 'function') {
    return { signal: anySignal(signals) }
  }
  const controller = new AbortController()
  const handlers = new Map<AbortSignal, () => void>()
  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }
  for (const signal of signals) {
    if (signal.aborted) {
      onAbort()
      break
    }
    const handler = () => onAbort()
    handlers.set(signal, handler)
    signal.addEventListener('abort', handler, { once: true })
  }
  const cleanup = () => {
    for (const [signal, handler] of handlers) {
      signal.removeEventListener('abort', handler)
    }
    handlers.clear()
  }
  return { signal: controller.signal, cleanup }
}
