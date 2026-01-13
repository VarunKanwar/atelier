# Observability Redesign (Browser-Only, Performance API + State API)

## Context and Motivation

Atelier is a browser-only task runtime. Each task dispatch flows through a
queue, may wait under backpressure, runs in a worker (singleton or pool), and
returns a result or error on the main thread. Observability needs to cover both
per-call latency (tracing) and current system state (queue depth, worker count).

Atelier currently ships two observability mechanisms:

1. **Runtime snapshots (polling)**  
   - `runtime.getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()` aggregate queue + worker state.
   - Data is derived from executor `getState()` calls on an interval.

2. **Telemetry events (opt-in, aggregated in-library)**  
   - `TaskConfig.telemetry?: TelemetrySink` emits task lifecycle events.
   - `createTelemetryStore()` aggregates counts + p50/p95 timings in memory.

This split mixes overlapping responsibilities (state + timing + aggregation),
which creates confusion, duplication, and maintenance overhead. It also forces
the library to provide aggregation logic (p50/p95) that belongs in consumer
tooling.

We want a single, coherent observability model that preserves:
- reliable access to current state,
- explicit trace context for workflows,
- raw, structured events without in-library aggregation,
- and browser-native timing for spans.

## Design Goals

- **No in-library aggregation** (consumers compute p50/p95/etc).
- **Explicit trace context**; avoid implicit async context.
- **State remains queryable** at any time.
- **Browser-only, zero dependencies**.
- **Structured, raw events** for consumers who want streams.
- **Minimal overhead** with clear throttling guidance.

## Non-Goals

- Distributed tracing across services.
- Backend export pipeline built into the library.
- Worker-internal timing (main-thread timing only, unless explicitly added later).
- Parent/child span hierarchies or implicit context propagation.

## High-Level Model

We keep three complementary observability surfaces:

1. **State API (authoritative current state)**  
   `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()`
2. **Performance API for spans + trace duration**  
   Task spans via `performance.measure('atelier:span', ...)`, trace duration via\n+   `performance.measure('atelier:trace', ...)`
3. **Event stream (canonical record)**  
   Raw `MetricEvent`, `SpanEvent`, `TraceEvent` via `subscribeEvents()`

**Rationale**
- The state API is authoritative because event streams can be lossy or delayed.
- Performance measures are browser-native and low-overhead for timing data.
- Events remain the canonical record when Performance entries are dropped.

## API Summary (New)

- `createTaskRuntime({ observability })`
- `runtime.getRuntimeSnapshot()` / `runtime.subscribeRuntimeSnapshot()`
- `runtime.subscribeEvents(listener)`
- `runtime.createTrace(name?)` → `TraceContext`
- `runtime.runWithTrace(name, fn)`

## Observability Configuration

Observability must be explicit to avoid accidental overhead:

- **Spans are opt-in.** If spans are disabled, no `performance.measure()` calls
  are created. Enable spans via runtime options.
- **Events are opt-in by subscription.** If no listeners are registered with
  `subscribeEvents()`, no events are emitted.
- **Defaults:** spans enabled in dev builds, disabled in production unless
  explicitly enabled. If the environment can’t be detected, default to spans
  disabled.
- **`spans: 'auto'`** means “enable in dev, disable in prod.” Dev detection can
  use `import.meta.env.DEV` (Vite) or `process.env.NODE_ENV !== 'production'`.
  If neither is available, treat as production (spans off).

**Sampling**
- Sampling applies to spans only; metrics events remain complete.
- Sampling is decided when a trace is created and stored on `TraceContext.sampled`.
- All spans in the trace follow this decision (trace-level sampling).
- If a span has **no trace**, sampling uses `sampleRate` per span (treat it as a
  root span, equivalent to OTel “no parent” behavior).

**Rationale**
- Opt-in spans prevent hidden overhead in production workloads.
- Trace-level sampling preserves complete traces without per-span inconsistency.

## Task Spans (Performance + SpanEvent)

### Performance measure

**Measure name**: `atelier:span` (no per-span suffix)

**Measure detail** (task spans):

```ts
{
  spanId: string,
  traceId?: string,
  traceName?: string,
  callId: string,
  taskId: string,
  taskName?: string,
  taskType: 'parallel' | 'singleton',
  method: string,
  workerIndex?: number,
  queueWaitMs?: number,
  queueWaitLastMs?: number,
  attemptCount: number,
  status: 'ok' | 'error' | 'canceled',
  errorKind?: 'abort' | 'queue' | 'crash' | 'exception',
  error?: string
}
```

**Detail availability**
- `detail` is optional. If a browser does not preserve `PerformanceMeasure.detail`,
  the measure may still be created without it. `SpanEvent` remains the canonical
  source of span metadata.
- `SpanEvent` mirrors the measure detail fields and adds `durationMs`.

### Span identity
- `spanId` is stable per call; we can reuse `callId` to avoid duplicate IDs.
- `callId` is generated by the executor once per task call (not per workflow).
  It exists for cancellation and in-flight tracking, not for observability.

### Lifecycle + timing
- Task spans start when a dispatch attempt is requested (before enqueue).
- Queue wait is measured from enqueue → dispatch for each attempt and summed into
  `queueWaitMs`. The last attempt’s wait may be recorded as `queueWaitLastMs`.
- Task spans end on final resolution: success, error, cancellation, or queue rejection.

**Rationale**
- Starting at dispatch request ensures rejected/dropped calls still get spans.
- Queue wait is tracked separately to diagnose backpressure vs execution time.

### Attempts + queue semantics
- `attemptCount` increments each time a call is dispatched.
- Requeues that never re-dispatch do not increment `attemptCount`.
- Queue rejections/drops never dispatch, so `attemptCount = 0`.

### Cancellation and rejection
- If a call is canceled before dispatch, end the span in the queue layer with
  `status: 'canceled'` and the elapsed queue time.
- If the queue rejects/drops a call (`reject`, `drop-latest`, `drop-oldest`), end
  the span immediately with `status: 'error'`, `errorKind: 'queue'`, and
  `attemptCount = 0`.

### Error classification
- `AbortError` → `status: 'canceled'`, `errorKind: 'abort'`.
- `WorkerCrashedError` → `status: 'error'`, `errorKind: 'crash'`.
- Other errors → `status: 'error'`, `errorKind: 'exception'`.

### Marks vs measures
- We emit **measures only** (durations). We do not emit marks.
- Measures are created with explicit `start`/`end` timestamps (from
  `performance.now()`) to avoid creating extra timeline entries for marks.
- Using `performance.now()` keeps durations monotonic and high‑resolution, and
  avoids clock‑skew issues that can affect `Date.now()`.

**Rationale**
- Measures capture duration directly; marks would add noise without extra value.

## Traces (Context + TraceEvent)

We provide **explicit trace context** only:

- `runtime.createTrace(name?)` returns a `TraceContext { id, name, sampled, end }`.
- `TraceContext.id` is used as `traceId` in span/trace measures and events.
- `runtime.runWithTrace(name, fn)` creates a trace, passes it to `fn`, and calls
  `trace.end()` automatically (with `status: 'ok' | 'error'`).
- `task.with({ trace })` is the only supported way to attach trace context.
- We avoid changing method signatures (no `task.method(..., { trace })`).

**Trace end**
- `trace.end()` emits a **trace measure** named `atelier:trace` (with duration)
  when spans are enabled and the trace is sampled.
- `trace.end()` also emits a `TraceEvent` for consumers who want reliable
  duration data without relying on Performance entries.
- Trace status is derived from the `runWithTrace` callback outcome:
  - resolve → `ok`
  - throw `AbortError` → `canceled`
  - throw anything else → `error`

**Trace measure detail**

```ts
{
  traceId: string,
  traceName?: string,
  status: 'ok' | 'error' | 'canceled',
  errorKind?: 'abort' | 'queue' | 'crash' | 'exception',
  error?: string
}
```

**No parent/child spans (by design)**
- We intentionally do **not** model parent/child span relationships.
- This avoids implicit context propagation, keeps span semantics simple, and
  prevents confusing partial hierarchies when user code branches or runs
  concurrent workflows.

**Rationale**
- Explicit traces avoid hidden context propagation (e.g., Zone.js).
- A separate trace measure provides workflow timing without forcing hierarchies.

**Note on cancellation keys**
- `keyOf(...)` returns a cancellation key, not a trace identifier.
- You may *name* a trace with that key (e.g., `doc:${id}`), but trace IDs should
  still be unique per workflow run to avoid conflating retries or concurrent runs.

## Event Stream (Canonical Record)

Metrics are **not** emitted via the Performance API. Instead, we expose a raw
stream for metrics and mirrored span/trace events for reliability:

```ts
type MetricEvent =
  | { kind: 'counter'; name: string; value: number; ts: number; attrs?: Record<string, string | number> }
  | { kind: 'gauge'; name: string; value: number; ts: number; attrs?: Record<string, string | number> }
  | { kind: 'histogram'; name: string; value: number; ts: number; attrs?: Record<string, string | number> }

type SpanEvent = {
  kind: 'span'
  name: 'atelier:span'
  ts: number
  spanId: string
  traceId?: string
  traceName?: string
  callId: string
  taskId: string
  taskName?: string
  taskType: 'parallel' | 'singleton'
  method: string
  workerIndex?: number
  queueWaitMs?: number
  queueWaitLastMs?: number
  attemptCount: number
  durationMs?: number
  status: 'ok' | 'error' | 'canceled'
  errorKind?: 'abort' | 'queue' | 'crash' | 'exception'
  error?: string
}

type TraceEvent = {
  kind: 'trace'
  name: 'atelier:trace'
  ts: number
  traceId: string
  traceName?: string
  durationMs?: number
  status: 'ok' | 'error' | 'canceled'
  errorKind?: 'abort' | 'queue' | 'crash' | 'exception'
  error?: string
}

type RuntimeEvent = MetricEvent | SpanEvent | TraceEvent

runtime.subscribeEvents((event) => { ... })
```

**Event stream behavior**
- Delivery is synchronous and best-effort; consumer exceptions are swallowed.
- Consumers should keep handlers fast; heavy work should be deferred or batched.

**Rationale**
- The event stream is authoritative; consumers can aggregate without coupling
  the core runtime to specific metrics backends.

## Metrics

### Metric Names (Initial Set)

Counters:
- `task.dispatch.total`
- `task.success.total`
- `task.failure.total`
- `task.canceled.total`
- `task.rejected.total`
- `worker.spawn.total`
- `worker.crash.total`
- `worker.terminate.total`
- `task.requeue.total`

Gauges:
- `queue.in_flight`
- `queue.pending`
- `queue.blocked`
- `workers.active`

Histograms:
- `task.duration_ms` (end-to-end span duration)
- `queue.wait_ms` (per dispatch attempt; total wait is in span detail)

**Metric attributes (required when applicable)**
- `task.id` (required for all task-scoped metrics)
- `task.type` (required for all task-scoped metrics)
- `task.name` (optional)
- `worker.index` (required for worker-scoped metrics)
- `queue.policy` (required for queue-scoped metrics)
- `queue.max_in_flight`, `queue.max_depth` (optional)

### Counter semantics

| Metric | Emitted when | Notes |
| --- | --- | --- |
| `task.dispatch.total` | each dispatch attempt starts | re-dispatch counts again |
| `task.success.total` | worker resolves successfully | |
| `task.failure.total` | worker throws non-`AbortError` or crash rejection | |
| `task.canceled.total` | queued cancel or in-flight abort | `AbortError` counts here, not failure |
| `task.rejected.total` | queue policy rejects/drops | includes drop-latest/drop-oldest |
| `worker.spawn.total` | worker created | |
| `worker.crash.total` | worker crash detected | |
| `worker.terminate.total` | worker terminated | |
| `task.requeue.total` | in-flight call requeued after crash | crash requeues only |

### Gauges
- Emitted after each queue mutation (enqueue, dequeue, dispatch, cancel, requeue).
- Values reflect post-mutation state.

**Rationale**
- Emitting on every mutation keeps state precise; consumers can throttle if needed.

### Trace events
- Trace events (`TraceEvent`) do not contribute to task/queue metrics.

## Implementation Mapping

**DispatchQueue (`src/dispatch-queue.ts`)**
- Emit `queue.*` gauge events on state changes.
- Emit counters on reject/cancel.
- End spans for queued cancellations and queue rejections/drops.

**WorkerPool / SingletonWorker (`src/worker-pool.ts`, `src/singleton-worker.ts`)**
- Create spans on dispatch request (before enqueue).
- End spans on final success/error/cancel.
- Emit `queue.wait_ms` histogram at each dispatch attempt.
- Emit worker lifecycle counters (`worker.spawn`, `worker.crash`, `worker.terminate`).

**Runtime (`src/runtime.ts`)**
- Keep `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()` as the authoritative
  state API.
- Add `subscribeEvents()` for raw metrics and span mirrors.
- Emit trace measures and `TraceEvent` on `trace.end()` when spans are enabled
  and the trace is sampled.

## User Workflows (Practical Guidance)

### 1) Per-workflow trace (recommended)
Use one trace per workflow instance (e.g., per document). This keeps traces
readable and makes it easy to debug a single item end-to-end.

```ts
await runtime.runWithTrace(`doc:${docId}`, async trace => {
  await normalize.with({ trace }).run(doc)
  await resize.with({ trace }).process(doc)
})
```

### 2) Batch correlation (optional)
If you process a batch of items and want to group them, use a batch attribute
in your app state or event processing. Avoid putting the entire batch into a
single trace unless you explicitly want a very large trace.

### 3) Metrics/state only (no traces)
If you only care about system health, you can skip trace creation entirely and
rely on:

- `getRuntimeSnapshot()` for current queue/worker state
- `subscribeEvents()` for metrics aggregation

## User Experience (Concrete Example)

Below is a minimal, practical setup that produces:
- **Spans** (per-call latency) via the Performance API
- **Metrics** (queue depth, drops, worker lifecycle) via `subscribeEvents()`
- **Current state** via `getRuntimeSnapshot()`

```ts
import { createTaskRuntime } from '@varunkanwar/atelier'

type ResizeAPI = {
  process: (image: ImageData) => Promise<ImageData>
}

const runtime = createTaskRuntime({
  observability: {
    spans: { sampleRate: 1 }, // opt-in spans (1 = sample all)
  },
})

const resize = runtime.defineTask<ResizeAPI>({
  type: 'parallel',
  poolSize: 2,
  worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
})

// 1) Spans: observe per-call latency via PerformanceObserver
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.name === 'atelier:span') {
      // entry.detail has span metadata (if supported by the browser)
      // fallback: use span events from subscribeEvents (below)
    }
  }
})
observer.observe({ entryTypes: ['measure'], buffered: true })

// 2) Metrics: subscribe to raw events (counters, gauges, histograms, spans)
runtime.subscribeEvents(event => {
  if (event.kind === 'gauge' && event.name === 'queue.pending') {
    // track queue depth over time
  }
  if (event.kind === 'span' && event.status === 'error') {
    // canonical span data even if Performance entries are dropped
  }
})

// 3) Current state: pull snapshots when needed
const state = runtime.getRuntimeSnapshot()
// state.tasks[...] includes queue + worker status

// 4) Trace a single workflow instance (recommended)
await runtime.runWithTrace('doc:123', async trace => {
  await resize.with({ trace }).process(imageData)
})
```

## OTel Conceptual Mapping (No Dependency)

We align the observability model to common OpenTelemetry (OTel) concepts without
bundling OTel:

- **Trace**: a single workflow instance (e.g., one document processed end-to-end).
- **Span**: one task call from dispatch request → completion (SpanKind.INTERNAL).
- **Status mapping**:
  - `ok` → OTel `OK`
  - `canceled` → OTel `UNSET` with `canceled=true` attribute
  - `error` → OTel `ERROR` with `error` message
- **Suggested attributes** (OTel-style, namespaced by domain):
  - `task.id`, `task.name`, `task.type`
  - `worker.index`
  - `queue.wait_ms`
  - `attempt.count`

**Where we intentionally deviate from OTel**
- **No parent/child span relationships** to avoid implicit context propagation.
- **Trace timing is emitted as a separate trace measure/event**, not a root span.
- **Browser-only Performance API + event stream** instead of OTel SDK/exporters.

## Why Not Depend on OpenTelemetry Directly?

We intentionally avoid making OpenTelemetry (OTel) a hard dependency for the
core runtime. The decision is based on practical constraints rather than
disagreement with OTel’s model:

- **Browser OTel is explicitly marked experimental** in the official
  documentation for client instrumentation. We do not want the core runtime to
  inherit experimental stability guarantees.
- **No official browser support list** is published; OTel aims to work on
  currently supported major browsers, which is a moving target and places the
  compatibility burden on the application.
- **Context propagation in the browser commonly relies on Zone.js**, and the
  ZoneContextManager has known limitations (e.g., it does not work with code
  targeting ES2017+ without transpiling back to ES2015). This is a meaningful
  constraint for modern TypeScript builds.
- **Dependency surface area**: even a minimal OTel setup in the browser pulls in
  multiple packages (API, web SDK, context manager, and optional instrumentations).
  For a small runtime, forcing those dependencies on every consumer is a heavy
  tradeoff, especially when many users only need lightweight tracing and state.

This spec keeps the **OTel mental model** (trace/span/status/attributes) so
consumers can build adapters or exporters when they want full OTel pipelines,
without making that a hard requirement.

## Breaking API Changes

We intend to remove:

- `TaskConfig.telemetry`
- `TelemetrySink` / `TaskEvent` types
- `createTelemetryStore()` and its tests

We intend to keep (or rename for clarity):

- `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()`

New API:

- `runtime.createTrace(name?)`
- `runtime.runWithTrace(name, fn)`
- `runtime.subscribeEvents(listener)`
- `createTaskRuntime({ observability })` or `runtime.enableSpans(...)` to opt-in to spans
  (dev builds default on; production default off unless enabled)
- Optional `runtime.observeSpans()` helper for `PerformanceObserver`

## Migration Notes

Consumers should migrate from:

- `createTelemetryStore()` → `subscribeEvents()` + own aggregation
- `getRuntimeSnapshot()` → remains available for current state
- existing observability demo → enable spans explicitly, then use
  `PerformanceObserver` for spans and `subscribeEvents()` for metrics

## Risks and Mitigations

- **Event volume**: emit gauges on change only; document optional throttling.
- **Span overhead**: keep spans opt-in; support sampling to bound volume.
- **Span metadata loss (detail unsupported)**: span end events are mirrored via
  `subscribeEvents()`; consumers can rely on `SpanEvent` as the canonical record.
- **Performance entry buffer loss**: spans are best-effort; state remains
  available via snapshot API.

## Future Extensions (Optional)

- Worker-internal spans by propagating context to workers.
- Optional adapter to export events to OTel without bundling it by default.
- Formal semantic conventions for attribute names.
