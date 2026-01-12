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

## Proposed Solution

### 1) Keep a State API (Authoritative Current State)

We retain a runtime state API for current values:

- Keep `getRuntimeSnapshot()` and `subscribeRuntimeSnapshot()` (or rename to
  `getRuntimeState()` / `subscribeRuntimeState()` if we want to clarify intent).
- This is the **authoritative source for current queue depths and worker state**.
- This avoids forcing consumers to reconstruct state from a lossy event stream.

### 2) Use the Performance API for Spans Only

Spans are a natural fit for `performance.measure()`:

- Each task call creates a **single end-to-end span** (enqueue → final completion).
- This span includes queue wait and retries, and ends even if canceled before dispatch.
- Measures are emitted on the main thread only.

**Measure name**: `atelier:span:{spanId}`  
**Measure detail**:

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
  attemptCount: number,
  status: 'ok' | 'error' | 'canceled',
  error?: string
}
```

**Attempt semantics**
- `attemptCount` increments each time a call is dispatched.
- The final span contains the total number of dispatched attempts for that call.
- Requeues that never re-dispatch do not increment `attemptCount`.

**Queued cancellation**
- If a call is canceled before dispatch, we still end the span in the queue layer
  with `status: 'canceled'` and the elapsed queue time.

**Abort and error classification**
- If the terminal error is an `AbortError`, the span ends with `status: 'canceled'`.
- Crash-related failures (e.g., `WorkerCrashedError`) end with `status: 'error'`.

**Span lifecycle**
- Span starts on enqueue (call accepted into the queue).
- Queue wait is measured as `dispatch_start_ts - enqueue_ts` (if dispatch occurs).
- Span ends on final resolution: success, error, or cancellation (including queued cancel).

### 3) Expose a Lightweight Event Stream for Metrics and Span Mirrors (No Aggregation)

Metrics are **not** emitted via the Performance API. Instead, we expose an
raw event stream for metrics and a mirrored span end event (for reliability):

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
  attemptCount: number
  durationMs?: number
  status: 'ok' | 'error' | 'canceled'
  error?: string
}

type RuntimeEvent = MetricEvent | SpanEvent

runtime.subscribeEvents((event) => { ... })
```

This preserves semantic correctness (counters vs gauges) without forcing
in-library aggregation. Consumers can aggregate or export however they want.
Span events provide a reliable fallback if `PerformanceEntry.detail` is unsupported
or performance buffers drop entries.

**Event stream behavior**
- Delivery is synchronous and best-effort; consumer exceptions are swallowed.
- Consumers should keep handlers fast; heavy work should be deferred or batched.

### 4) Reliability and Lossiness

- **State**: always available via `getRuntimeSnapshot()`.
- **Spans**: Performance entries can be lossy; consumers should treat them as
  best-effort. Span end events are mirrored through `subscribeEvents()` as
  `kind: 'span'` for reliability.
- **Events**: callbacks fire as events happen; consumers must avoid blocking.

### 5) Trace Grouping (Workflow Traces)

We provide **explicit trace context** only:

- `runtime.createTrace(name?)` returns a `TraceContext { id, name }`.
- `task.with({ trace })` is the only supported way to attach trace context.
- We avoid changing method signatures (no `task.method(..., { trace })`).

This keeps usage explicit and avoids implicit async context propagation.

## OTel Conceptual Mapping (No Dependency)

We align the observability model to common OpenTelemetry (OTel) concepts without
bundling OTel:

- **Trace**: a single workflow instance (e.g., one document processed end-to-end).
- **Span**: one task call from enqueue → completion (SpanKind.INTERNAL).
- **Status mapping**:
  - `ok` → OTel `OK`
  - `canceled` → OTel `UNSET` with `canceled=true` attribute
  - `error` → OTel `ERROR` with `error` message
- **Suggested attributes** (OTel-style, namespaced by domain):
  - `task.id`, `task.name`, `task.type`
  - `worker.index`
  - `queue.wait_ms`
  - `attempt.count`

This makes traces and spans easy to reason about for users who already think in
OTel terms, while keeping the implementation lightweight and browser-only.

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

## User Workflows (Practical Guidance)

### 1) Per-workflow trace (recommended)
Use one trace per workflow instance (e.g., per document). This keeps traces
readable and makes it easy to debug a single item end-to-end.

```ts
const trace = runtime.createTrace(`doc:${docId}`)

await normalize.with({ trace }).run(doc)
await resize.with({ trace }).process(doc)
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

## Metric Names (Initial Set)

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
- `task.duration_ms` (end-to-end)
- `queue.wait_ms`

## Emission Points (Implementation Mapping)

**DispatchQueue (`src/dispatch-queue.ts`)**
- Emit `queue.*` gauge events on state changes.
- Emit counters on reject/cancel.
- End spans for queued cancellations.

**WorkerPool / SingletonWorker (`src/worker-pool.ts`, `src/singleton-worker.ts`)**
- Create spans on enqueue.
- End spans on final success/error/cancel.
- Emit `queue.wait_ms` histogram at dispatch.
- Emit worker lifecycle counters (`worker.spawn`, `worker.crash`, `worker.terminate`).

**Runtime (`src/runtime.ts`)**
- Keep `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()` as the authoritative
  state API.
- Add `subscribeEvents()` for raw metrics and span mirrors.

## Event Semantics (Counters and Statuses)

**Counters**

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
| `task.requeue.total` | in-flight call requeued after crash | |

**Span status**
- `ok`: handler completes without throwing.
- `error`: any non-`AbortError` failure, including `WorkerCrashedError`.
- `canceled`: queued cancellation or in-flight abort (`AbortError`).

**Gauges**
- Emitted after each queue mutation (enqueue, dequeue, dispatch, cancel, requeue).
- Values reflect post-mutation state.

## Breaking API Changes

We intend to remove:

- `TaskConfig.telemetry`
- `TelemetrySink` / `TaskEvent` types
- `createTelemetryStore()` and its tests

We intend to keep (or rename for clarity):

- `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()`

New API:

- `runtime.createTrace(name?)`
- `runtime.subscribeEvents(listener)`
- Optional `runtime.observeSpans()` helper for `PerformanceObserver`

## Migration Notes

Consumers should migrate from:

- `createTelemetryStore()` → `subscribeEvents()` + own aggregation
- `getRuntimeSnapshot()` → remains available for current state
- existing observability demo → use `PerformanceObserver` for spans and
  `subscribeEvents()` for metrics

## Risks and Mitigations

- **Event volume**: emit gauges on change only; document optional throttling.
- **Span metadata loss (detail unsupported)**: span end events are mirrored via
  `subscribeEvents()`; consumers can rely on `SpanEvent` as the canonical record.
- **Performance entry buffer loss**: spans are best-effort; state remains
  available via snapshot API.

## Future Extensions (Optional)

- Worker-internal spans by propagating context to workers.
- Optional adapter to export events to OTel without bundling it by default.
- Formal semantic conventions for attribute names.
