export type AbortKey = string

export type AbortTaskController = {
  signalFor(key: AbortKey): AbortSignal
  abort(key: AbortKey): void
  abortMany(keys: AbortKey[]): void
  isAborted(key: AbortKey): boolean
  clear(key: AbortKey): void
  clearAll(): void
}

export const createAbortTaskController = (): AbortTaskController => {
  const controllers = new Map<AbortKey, AbortController>()

  const getOrCreate = (key: AbortKey): AbortController => {
    const existing = controllers.get(key)
    if (existing) return existing
    const created = new AbortController()
    controllers.set(key, created)
    return created
  }

  return {
    signalFor(key) {
      return getOrCreate(key).signal
    },
    abort(key) {
      const controller = getOrCreate(key)
      if (!controller.signal.aborted) {
        controller.abort()
      }
    },
    abortMany(keys) {
      for (const key of keys) {
        const controller = getOrCreate(key)
        if (!controller.signal.aborted) {
          controller.abort()
        }
      }
    },
    isAborted(key) {
      const controller = controllers.get(key)
      return controller?.signal.aborted ?? false
    },
    clear(key) {
      controllers.delete(key)
    },
    clearAll() {
      controllers.clear()
    },
  }
}
