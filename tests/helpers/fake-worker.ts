export type DispatchHandler = (
  callId: string,
  method: string,
  args: unknown[],
  key?: string,
) => Promise<unknown>

export class FakeWorker {
  private listeners = new Map<string, Set<(event: unknown) => void>>()
  terminated = false
  readonly __dispatch: DispatchHandler
  readonly __cancel?: (callId: string) => void

  constructor(dispatch: DispatchHandler, cancel?: (callId: string) => void) {
    this.__dispatch = dispatch
    this.__cancel = cancel
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type)
    if (existing) {
      existing.add(handler)
      return
    }
    this.listeners.set(type, new Set([handler]))
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type)
    if (!existing) return
    existing.delete(handler)
    if (existing.size === 0) {
      this.listeners.delete(type)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  emitError(error?: unknown): void {
    this.emit('error', { error })
  }

  emitMessageError(data?: unknown): void {
    this.emit('messageerror', { data })
  }

  private emit(type: string, event: unknown): void {
    const handlers = this.listeners.get(type)
    if (!handlers) return
    for (const handler of handlers) {
      handler(event)
    }
  }
}
