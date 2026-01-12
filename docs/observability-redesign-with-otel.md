# Observability Redesign (Browser-Only, OpenTelemetry)

## Context and Motivation

Atelier is a browser-only task runtime. Each task dispatch flows through a
queue, may wait under backpressure, runs in a worker (singleton or pool), and
returns a result or error on the main thread. Observability needs to cover both
per-call latency (tracing) and current system state (queue depth, worker count).

We want a single, standardized observability model that can integrate with
existing telemetry pipelines. This alternate design uses **OpenTelemetry (OTel)**
directly for traces and metrics in the browser.

## Design Goals

- **OTel-native** traces and metrics (no custom event bus).
- **No in-library aggregation** (consumers compute p50/p95/etc).
- **State remains queryable** at any time.
- **Explicit trace context** support for deterministic workflows.
- **Browser-only**; no server-side dependencies.

## Non-Goals

- Distributed tracing across services by default (can be done by the app).
- Worker-internal timing (main-thread timing only, unless added later).
- Log export pipelines.

## Proposed Solution

### 1) Use OpenTelemetry for Spans and Metrics

Atelier emits:
- **Spans** via the OTel Tracing API
- **Metrics** via the OTel Metrics API (counters, histograms, observable gauges)

We do not implement aggregation. We only emit raw spans/metrics; the consumer’s
OTel pipeline handles storage and aggregation.

### 2) Keep a State API (Authoritative Current State)

We retain a runtime state API for current values:

- Keep `getRuntimeSnapshot()` and `subscribeRuntimeSnapshot()` (or rename to
  `getRuntimeState()` / `subscribeRuntimeState()` if we want to clarify intent).
- This remains the authoritative source for current queue depths and worker
  state, independent of OTel collection intervals.

### 3) Trace Context and Propagation

We support two complementary modes:

1) **Explicit trace context** (recommended for deterministic workflows)
   - `runtime.createTrace(name?)` returns `{ traceId, traceName? }`
   - `task.with({ trace })` attaches trace context to a call

2) **OTel context propagation** (optional)
   - If the application configures a context manager (e.g., ZoneContextManager),
     Atelier will use `context.active()` when creating spans.

For worker boundaries, we do **explicit propagation** by passing trace context
alongside the worker call. This avoids relying on async context propagation
inside workers.

## Data Model (OTel Mapping)

### Spans

Each task call creates a single **end-to-end span** (enqueue → final completion).

**Span name**: `atelier.task`

**Attributes** (OTel-style, namespaced):
- `atelier.task.id`
- `atelier.task.name`
- `atelier.task.type` (`parallel` | `singleton`)
- `atelier.task.method`
- `atelier.worker.index`
- `atelier.queue.wait_ms`
- `atelier.attempt.count`

**Status mapping**
- `ok` → Span status `OK`
- `canceled` → Span status `UNSET` + `atelier.canceled=true`
- `error` → Span status `ERROR` + exception recorded

**Attempt semantics**
- `attemptCount` increments each time a call is dispatched.
- Requeues that never re-dispatch do not increment `attemptCount`.

### Metrics

We emit the following instruments:

**Counters**
- `task.dispatch.total`
- `task.success.total`
- `task.failure.total`
- `task.canceled.total`
- `task.rejected.total`
- `worker.spawn.total`
- `worker.crash.total`
- `worker.terminate.total`
- `task.requeue.total`

**Histograms**
- `task.duration_ms` (end-to-end)
- `queue.wait_ms`

**Observable gauges**
- `queue.in_flight`
- `queue.pending`
- `queue.blocked`
- `workers.active`

All metric attributes follow the `atelier.*` namespace, e.g.:
- `atelier.task.id`
- `atelier.task.name`
- `atelier.task.type`
- `atelier.worker.index`
- `atelier.queue.policy`

## Emission Points (Implementation Mapping)

**DispatchQueue (`src/dispatch-queue.ts`)**
- Track queue state for observable gauges.
- Increment `task.rejected.total` for reject/drop.
- Increment `task.canceled.total` for queued cancellations.
- End spans for queued cancellations (status `canceled`).

**WorkerPool / SingletonWorker (`src/worker-pool.ts`, `src/singleton-worker.ts`)**
- Start span on enqueue (parent from trace context or active context).
- Record `queue.wait_ms` histogram at dispatch.
- Increment `task.dispatch.total` at dispatch.
- End span on success/error/cancel.
- Record `task.duration_ms` histogram on completion.
- Increment success/failure/canceled counters.
- Increment worker lifecycle counters (`worker.spawn/crash/terminate`).
- Increment `task.requeue.total` when in-flight work is requeued after a crash.

**Runtime (`src/runtime.ts`)**
- Keep `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()` as authoritative state.
- Provide `subscribeEvents()` only if we retain a lightweight event stream for
  debug tooling (optional in this OTel-first design).

## API Surface (OTel-First)

We rely on OTel’s global API by default:
- `trace.getTracer('atelier')`
- `metrics.getMeter('atelier')`

Optional configuration for explicit injection:

```ts
type OTelConfig = {
  tracer?: Tracer
  meter?: Meter
}

const runtime = createTaskRuntime({ otel: { tracer, meter } })
```

**TaskDispatchOptions**

```ts
type TraceContext = {
  traceId: string
  spanContext?: SpanContext
  name?: string
  end?: () => void
}

task.with({ trace: TraceContext })
```

If `trace` is provided, we create spans as children of `trace.spanContext` and
attach `traceId` to all span attributes.

## Trace Grouping (Workflow Traces)

We provide an explicit trace helper that creates a root span for a workflow:

```ts
const trace = runtime.createTrace('doc:123')
await normalize.with({ trace }).run(doc)
await resize.with({ trace }).process(doc)
trace.end()
```

If the application already has an OTel span context, it can supply that directly
via `task.with({ trace: { spanContext } })` and keep full control over trace
boundaries.

## User Workflows (Practical Guidance)

### 1) Per-workflow trace (recommended)
Use one trace per workflow instance (e.g., per document). This keeps traces
readable and makes it easy to debug a single item end-to-end.

### 2) Batch correlation (optional)
Use a batch identifier as a span attribute (e.g., `atelier.batch.id`) rather
than forcing all items into one trace.

### 3) Metrics/state only (no traces)
If you only care about system health, skip trace creation and rely on:
- OTel metrics
- `getRuntimeSnapshot()` for current state

## Migration Notes (from non-OTel observability)

- Replace `createTelemetryStore()` with OTel metrics aggregation.
- Replace Performance API spans with OTel spans.
- Keep `getRuntimeSnapshot()` for authoritative current state.

## Risks and Mitigations

- **Context propagation in the browser** depends on the application’s context
  manager; we provide explicit trace context as a deterministic fallback.
- **Worker boundaries** require explicit trace propagation; we always pass
  trace context with worker calls instead of relying on implicit async context.
- **Metric collection intervals** are controlled by the OTel MeterProvider; we
  keep `getRuntimeSnapshot()` for immediate reads.
