export type TaskContext = {
  signal: AbortSignal
  key?: string
  callId: string
  throwIfAborted: () => void
}

export type TaskHandlerMap = Record<string, (...args: any[]) => any>

export type StripTaskContext<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer Result
    ? Args extends [...infer Rest, TaskContext]
      ? (...args: Rest) => Result
      : T[K]
    : T[K]
}

export const createTaskWorker = <T extends TaskHandlerMap>(handlers: T) => {
  const active = new Map<string, AbortController>()

  const getAbortError = () => {
    const error = new Error('Task was aborted')
    ;(error as Error & { name?: string }).name = 'AbortError'
    return error
  }

  return {
    async __dispatch(callId: string, method: keyof T, args: unknown[], key?: string) {
      const controller = new AbortController()
      active.set(callId, controller)
      const ctx: TaskContext = {
        signal: controller.signal,
        key,
        callId,
        throwIfAborted: () => {
          if (controller.signal.aborted) {
            throw getAbortError()
          }
        },
      }

      try {
        const handler = handlers[method]
        if (typeof handler !== 'function') {
          throw new Error(`Method '${String(method)}' not found on worker handlers`)
        }
        return await handler(...args, ctx)
      } finally {
        active.delete(callId)
      }
    },
    __cancel(callId: string) {
      active.get(callId)?.abort()
    },
  }
}
