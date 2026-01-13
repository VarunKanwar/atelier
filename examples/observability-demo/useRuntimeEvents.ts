import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RuntimeEvent, SpanEvent, TaskRuntime, TraceEvent } from '../../src'

export type RuntimeEventStats = {
  counters: Record<string, number>
  lastQueueWaitMs?: number
  lastTaskDurationMs?: number
  spans: SpanEvent[]
  traces: TraceEvent[]
  lastTraceId?: string
  spansByTraceId: Record<string, SpanEvent[]>
  updatedAt: number
}

export type UseRuntimeEventsOptions = {
  enabled?: boolean
  flushIntervalMs?: number
}

const createEmptyStats = (): RuntimeEventStats => ({
  counters: {},
  spans: [],
  traces: [],
  spansByTraceId: {},
  updatedAt: Date.now(),
})

const cloneStats = (stats: RuntimeEventStats): RuntimeEventStats => ({
  counters: { ...stats.counters },
  lastQueueWaitMs: stats.lastQueueWaitMs,
  lastTaskDurationMs: stats.lastTaskDurationMs,
  spans: [...stats.spans],
  traces: [...stats.traces],
  lastTraceId: stats.lastTraceId,
  spansByTraceId: Object.fromEntries(
    Object.entries(stats.spansByTraceId).map(([traceId, spans]) => [traceId, [...spans]])
  ),
  updatedAt: stats.updatedAt,
})

const applyEvent = (buffer: RuntimeEventStats, event: RuntimeEvent) => {
  buffer.updatedAt = Date.now()

  if (event.kind === 'counter') {
    buffer.counters[event.name] = (buffer.counters[event.name] ?? 0) + event.value
    return
  }

  if (event.kind === 'histogram') {
    if (event.name === 'queue.wait_ms') {
      buffer.lastQueueWaitMs = event.value
    }
    if (event.name === 'task.duration_ms') {
      buffer.lastTaskDurationMs = event.value
    }
    return
  }

  if (event.kind === 'span') {
    const spans = buffer.spans
    spans.unshift(event)
    if (spans.length > 6) {
      spans.length = 6
    }
    if (event.traceId) {
      const traceSpans = buffer.spansByTraceId[event.traceId] ?? []
      traceSpans.push(event)
      if (traceSpans.length > 400) {
        traceSpans.splice(0, traceSpans.length - 400)
      }
      buffer.spansByTraceId[event.traceId] = traceSpans
    }
    return
  }

  if (event.kind === 'trace') {
    const traces = buffer.traces
    traces.unshift(event)
    if (traces.length > 4) {
      traces.length = 4
    }
    buffer.lastTraceId = event.traceId
    buffer.spansByTraceId[event.traceId] = buffer.spansByTraceId[event.traceId] ?? []
  }
}

export const useRuntimeEvents = (
  runtime: TaskRuntime,
  options: UseRuntimeEventsOptions = {}
): { stats: RuntimeEventStats; reset: () => void } => {
  const { enabled = true, flushIntervalMs = 250 } = options
  const [stats, setStats] = useState<RuntimeEventStats>(() => createEmptyStats())
  const bufferRef = useRef<RuntimeEventStats>(createEmptyStats())
  const lastFlushRef = useRef(0)

  const reset = useCallback(() => {
    const empty = createEmptyStats()
    bufferRef.current = empty
    lastFlushRef.current = empty.updatedAt
    setStats(empty)
  }, [])

  const flushInterval = useMemo(() => flushIntervalMs, [flushIntervalMs])

  useEffect(() => {
    if (!enabled) return

    const unsubscribe = runtime.subscribeEvents((event: RuntimeEvent) => {
      applyEvent(bufferRef.current, event)
    })

    const intervalId = setInterval(() => {
      const buffer = bufferRef.current
      if (buffer.updatedAt <= lastFlushRef.current) return
      lastFlushRef.current = buffer.updatedAt
      setStats(cloneStats(buffer))
    }, flushInterval)

    return () => {
      clearInterval(intervalId)
      unsubscribe()
    }
  }, [enabled, runtime, flushInterval])

  return { stats, reset }
}
