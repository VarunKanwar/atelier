import type { ObservabilityContext, RuntimeEvent, SpanErrorKind, TraceContext } from './types'

export const createNoopObservabilityContext = (): ObservabilityContext => ({
  spansEnabled: false,
  sampleRate: 1,
  now: () =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(),
  emitEvent: (_event: RuntimeEvent) => {},
  emitMeasure: (_name: string, _start: number, _end: number, _detail?: object) => {},
  shouldSampleSpan: (_trace: TraceContext | undefined, _spanId: string) => false,
})

export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  return (error as { name?: string }).name === 'AbortError'
}

export const classifyErrorKind = (error: unknown): SpanErrorKind => {
  if (!error || typeof error !== 'object') return 'exception'
  const name = (error as { name?: string }).name
  if (name === 'AbortError') return 'abort'
  if (name === 'WorkerCrashedError') return 'crash'
  if (name === 'QueueDropError') return 'queue'
  return 'exception'
}

export const stringifyError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export const sampleById = (id: string, sampleRate: number): boolean => {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const ratio = (hash >>> 0) / 2 ** 32
  return ratio < sampleRate
}
