# Observability Redesign: Performance API Integration

## Problem Statement

The current observability system has two parallel tracking mechanisms:

1. **RuntimeSnapshot** - Automatic, polling-based state from `getState()`
2. **TelemetryStore** - Opt-in, event-driven aggregation via `telemetry.emit`

This creates several issues:

- **Duplication**: Both systems track similar metrics (in-flight counts, queue depths, worker counts)
- **Confusing API**: Users face unclear choices about which system to use
- **Maintenance burden**: Events scattered across 12+ call sites, state updates in two places
- **Type inconsistency**: Two similar but incompatible snapshot types
- **Wrong abstraction**: Library calculates time-series aggregates (p50/p95) that belong in consumer tooling
- **Opt-in friction**: Most useful metrics (latencies) require manual wiring

## Proposed Solution

**Standardize on the browser's Performance API** with automatic trace correlation:

1. Use `performance.mark()` and `performance.measure()` for all timing
2. Emit measurements only on the main thread (skip worker-internal complexity)
3. Provide optional trace correlation via `runtime.trace()` wrapper
4. Let consumers use standard `PerformanceObserver` for observation
5. Remove custom aggregation - emit raw measurements only

## Design Goals

- ✅ Standard browser API (PerformanceObserver pattern)
- ✅ Zero-config for basic usage (every dispatch auto-tracked)
- ✅ Optional explicit correlation for workflows
- ✅ No time-series aggregation in library
- ✅ Automatic DevTools integration
- ✅ Simple implementation

## API Design

### Automatic Span Tracking

Every task dispatch automatically creates a performance measurement:

```typescript
// User code - zero configuration needed
const result = await resizeTask.process(image)

// Library automatically creates:
// - performance.mark('atelier:span:${spanId}:start')
// - performance.mark('atelier:span:${spanId}:end')
// - performance.measure('atelier:span:${spanId}', start, end)
```

### Trace Correlation (Optional)

For workflows involving multiple tasks, users can correlate spans:

```typescript
// Option A: Named trace (recommended for debugging)
await runtime.trace('process-image', async () => {
  const resized = await resizeTask.process(image)
  const enhanced = await enhanceTask.process(resized)
  const analyzed = await analyzeTask.process(enhanced)
  return analyzed
})

// Option B: Anonymous trace (just correlation)
await runtime.trace(async () => {
  const resized = await resizeTask.process(image)
  const enhanced = await enhanceTask.process(resized)
  return enhanced
})
```

When wrapped in `runtime.trace()`, all dispatches automatically inherit the trace ID via scoped context.

### Observing Measurements

Consumers use standard `PerformanceObserver`:

```typescript
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name.startsWith('atelier:')) {
      console.log({
        name: entry.name,           // 'atelier:span:xyz' or 'atelier:trace:abc'
        duration: entry.duration,   // ms (high-resolution)
        startTime: entry.startTime, // relative to navigationStart
        detail: entry.detail        // { traceId?, spanId, taskId, taskName?, ... }
      })
    }
  }
})

// Observe all measures
observer.observe({ type: 'measure', buffered: true })

// Or observe specific patterns
observer.observe({ entryTypes: ['mark', 'measure'] })
```

### Metadata in `detail` Field

Each performance entry includes rich metadata:

```typescript
// Trace measure
{
  name: 'atelier:trace:a3f9b2',
  duration: 1523.4,
  detail: {
    traceId: 'a3f9b2',
    traceName: 'process-image',  // if provided
    spanCount: 3                 // number of spans in trace
  }
}

// Span measure
{
  name: 'atelier:span:x7k2p',
  duration: 234.7,
  detail: {
    spanId: 'x7k2p',
    traceId: 'a3f9b2',           // if part of trace
    taskId: 'resize-worker',
    taskName: 'Image Resize',    // if provided
    method: 'process',
    workerIndex: 2,
    queueWaitMs: 12.3            // time spent in queue
  }
}
```

### Consumer Aggregation Example

Library provides no aggregation - consumers can use standard tooling:

```typescript
// Example: Compute p50/p95 for a task
const durations = performance
  .getEntriesByType('measure')
  .filter(e => e.name.startsWith('atelier:span:') && e.detail?.taskId === 'resize')
  .map(e => e.duration)
  .sort((a, b) => a - b)

const p50 = durations[Math.floor(durations.length * 0.5)]
const p95 = durations[Math.floor(durations.length * 0.95)]

// Or use a library like d3-array
import { quantile } from 'd3-array'
const p95 = quantile(durations, 0.95)
```

## Implementation Notes

### Trace Context Propagation

The `Runtime` class maintains optional trace context:

```typescript
class Runtime {
  private activeTrace?: { id: string; name?: string }

  async trace<T>(
    nameOrFn: string | (() => Promise<T>),
    fn?: () => Promise<T>
  ): Promise<T> {
    const [traceName, callback] = typeof nameOrFn === 'string'
      ? [nameOrFn, fn!]
      : [undefined, nameOrFn]

    const traceId = crypto.randomUUID()
    const prevTrace = this.activeTrace
    this.activeTrace = { id: traceId, name: traceName }

    const markStart = `atelier:trace:${traceId}:start`
    const markEnd = `atelier:trace:${traceId}:end`

    performance.mark(markStart, {
      detail: { traceId, traceName }
    })

    try {
      return await callback()
    } finally {
      performance.mark(markEnd)
      performance.measure(
        `atelier:trace:${traceId}`,
        markStart,
        markEnd,
        { detail: { traceId, traceName } }
      )

      // Clean up marks to avoid memory bloat
      performance.clearMarks(markStart)
      performance.clearMarks(markEnd)

      this.activeTrace = prevTrace
    }
  }
}
```

### Span Creation in Executors

Both `WorkerPool` and `SingletonWorker` create spans during dispatch:

```typescript
async dispatchToWorker(payload: WorkerCall, queueWaitMs: number) {
  const spanId = crypto.randomUUID()
  const traceId = this.runtime.getActiveTraceId() // Access to runtime's activeTrace

  const markStart = `atelier:span:${spanId}:start`
  const markEnd = `atelier:span:${spanId}:end`

  performance.mark(markStart, {
    detail: {
      spanId,
      traceId,
      taskId: this.taskId,
      taskName: this.taskName,
      method: payload.method,
      workerIndex
    }
  })

  try {
    const result = await workerDispatch(...)

    performance.mark(markEnd)
    performance.measure(
      `atelier:span:${spanId}`,
      markStart,
      markEnd,
      {
        detail: {
          spanId,
          traceId,
          taskId: this.taskId,
          taskName: this.taskName,
          method: payload.method,
          workerIndex,
          queueWaitMs
        }
      }
    )

    // Clean up marks
    performance.clearMarks(markStart)
    performance.clearMarks(markEnd)

    return result
  } catch (error) {
    // Still create measure for failed spans
    performance.mark(markEnd)
    performance.measure(
      `atelier:span:${spanId}`,
      markStart,
      markEnd,
      {
        detail: {
          spanId,
          traceId,
          taskId: this.taskId,
          error: String(error)
        }
      }
    )

    performance.clearMarks(markStart)
    performance.clearMarks(markEnd)

    throw error
  }
}
```

### Mark Cleanup Strategy

Performance marks accumulate in memory. Strategy:

1. Clear start/end marks immediately after creating measure
2. Keep measures for consumer observation
3. Optionally provide `runtime.clearMeasures()` utility
4. Document that consumers should use `buffered: true` on observer

### What's Captured

**Included:**
- Total dispatch time (queue → response)
- Queue wait time (time in DispatchQueue)
- Task/worker identification
- Trace correlation
- Method name
- Worker index (for parallel tasks)

**Excluded (too complex for v1):**
- Worker-internal execution time (would require worker → main messaging)
- Message serialization overhead breakdown
- Per-method aggregates (consumer's responsibility)

### DevTools Integration

Automatic benefits from Performance API:

1. **Chrome DevTools Performance Tab**:
   - Record performance profile
   - See `atelier:*` measures in Timings track
   - Hover for duration and metadata
   - Filter/search by name

2. **Programmatic Access**:
   - `performance.getEntries()` - all entries
   - `performance.getEntriesByType('measure')` - just measures
   - `performance.getEntriesByName('atelier:span:xyz')` - specific entry

3. **Export**:
   - Can export to Chrome Trace Format (future enhancement)
   - Standard PerformanceEntry JSON serialization

## Migration Path

### Phase 1: Add Performance API (non-breaking)

1. Add `runtime.trace()` method
2. Create performance marks/measures in executors
3. Keep existing `telemetry` parameter working
4. Keep existing `RuntimeSnapshot` working
5. Document new Performance API approach

### Phase 2: Deprecate Old System

1. Mark `telemetry` parameter as deprecated
2. Mark `createTelemetryStore()` as deprecated
3. Add migration guide to docs
4. Update examples to use PerformanceObserver

### Phase 3: Remove (breaking change)

1. Remove `TelemetrySink` type
2. Remove `telemetry` parameter from `TaskConfig`
3. Remove `createTelemetryStore()` export
4. Remove `src/telemetry.ts`
5. Simplify `RuntimeSnapshot` to remove duplicated fields
6. Update tests

## Benefits

### For Library Maintainers

- **Less code**: Remove ~400 lines of aggregation logic + tests
- **Standard API**: No custom event system to maintain
- **Simpler testing**: No need to mock event streams
- **Better separation**: Timing is browser's job, coordination is ours

### For Library Users

- **Zero config**: Works out of box, no telemetry wiring
- **Standard API**: Familiar PerformanceObserver pattern
- **Flexible**: Choose your own aggregation strategy
- **DevTools**: Free integration with browser tools
- **Lightweight**: No memory overhead for sample buffers

### For Debugging

- **Visual timeline**: See spans in DevTools Performance tab
- **Trace correlation**: Group related spans by traceId
- **Rich metadata**: taskId, workerIndex, queueWaitMs in detail
- **Export**: Can export traces to external tools

## Open Questions

1. **Entry naming convention**: Use `atelier:span:${id}` or `atelier:${taskId}:${id}`?
2. **Measure retention**: Should we auto-clear old measures, or leave to consumer?
3. **Error handling**: Include error details in `detail` field, or separate error marks?
4. **Worker timing**: Add in future, or permanently defer to consumers?

## References

- [PerformanceObserver API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)
- [performance.mark() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/mark)
- [performance.measure() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measure)
- [User Timing Level 3 Spec](https://w3c.github.io/user-timing/)
