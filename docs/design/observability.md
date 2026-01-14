# Observability Design

Atelier exposes observability as three complementary surfaces: current state,
raw events, and optional performance measures. The goal is to provide reliable
telemetry without in-library aggregation or hidden overhead.

## Goals

- No in-library aggregation (p50/p95/etc belongs to consumers).
- Explicit trace context; no implicit async propagation.
- State is queryable at any time.
- Browser-only, zero dependencies.
- Raw structured events for consumers who want streams.
- Minimal overhead with clear opt-in and sampling.

## Non-goals

- Distributed tracing across services.
- Backend export pipeline in the core runtime.
- Worker-internal timing (main-thread timing only).
- Parent/child span hierarchies or implicit context propagation.

## Three observability surfaces

1. **State API** (authoritative current state)
   - `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()`
2. **Event stream** (canonical record)
   - `subscribeEvents()` emits counters, gauges, histograms, spans, traces
3. **Performance API measures** (best-effort spans/trace timing)
   - `performance.measure('atelier:span', ...)`
   - `performance.measure('atelier:trace', ...)`

Recommended usage:
- Use `subscribeEvents()` as the canonical telemetry stream.
- Use Performance measures for profiling/devtools only; they can drop entries or
  omit `detail` depending on browser support.

## Configuration and opt-in

Observability must be explicit to avoid accidental overhead:

- **Spans are opt-in.** Enable via `createTaskRuntime({ observability: { spans } })`.
- **Events are opt-in by subscription.** If no listeners are registered,
  no events are emitted.
- Default `spans: 'auto'` means enable in dev, disable in prod.
- Sampling is trace-level when a trace is present. Without a trace, sampling
  uses the span id (root-span behavior).

Dev/prod detection prefers `import.meta.env.DEV`, then falls back to
`process.env.NODE_ENV !== 'production'` when available. If neither is present,
`'auto'` behaves as production (spans off).

## Trace model

Tracing is explicit and opt-in:

- `runtime.createTrace(name?) -> TraceContext`
- `runtime.runWithTrace(name, fn)` creates a trace and calls `trace.end()`
- `task.with({ trace })` is the only supported way to attach trace context

There is **no implicit propagation** and **no parent/child hierarchy**.
A trace represents a workflow instance; each task call is a span.

`trace.end()` emits:

- a trace measure (`atelier:trace`) when spans are enabled and the trace is
  sampled, and
- a `TraceEvent` under the same gating (spans enabled + sampled).

Note: cancellation keys (`keyOf(...)`) are not trace identifiers. You may name a
trace using a key, but trace ids should remain unique per workflow run.

## Span model

A span represents one task call from dispatch request to completion.
Spans start before enqueue so rejected/dropped calls are captured.

Key details:

- `spanId` is stable per call (reuses `callId`).
- `attemptCount` increments each time a call is dispatched.
- `queueWaitMs` is cumulative across attempts; `queueWaitLastMs` is the last
  attempt's wait time.
- End status: `ok`, `error`, or `canceled`.

Queue rejections and drops end spans immediately with `errorKind: 'queue'` and
`attemptCount = 0`.

Error classification:

- `AbortError` -> `canceled` / `abort`
- `WorkerCrashedError` -> `error` / `crash`
- queue drops/rejects -> `error` / `queue`
- other errors -> `error` / `exception`

## Event stream

Events are delivered synchronously and best-effort; consumer errors are
swallowed. Keep handlers fast and offload heavy work.

The stream emits:

- counters
- gauges
- histograms
- span events (mirroring span measures)
- trace events

Span and trace events are emitted only when spans are enabled and the trace/span
is sampled. Metric events are independent of span sampling.

The event stream is the canonical record, even if Performance entries drop.

## Metrics

Initial metric set:

Counters:
- `task.dispatch.total`
- `task.success.total`
- `task.failure.total`
- `task.canceled.total`
- `task.rejected.total`
- `task.requeue.total`
- `worker.spawn.total`
- `worker.crash.total`
- `worker.terminate.total`

Gauges:
- `queue.in_flight`
- `queue.pending`
- `queue.blocked`
- `workers.active`

Histograms:
- `task.duration_ms`
- `queue.wait_ms`

Gauges are emitted on queue state changes. Histograms and counters are emitted
at dispatch/complete/cancel/reject boundaries.

### Metric attributes

Required when applicable:

- `task.id` (all task-scoped metrics)
- `task.type` (all task-scoped metrics)
- `task.name` (optional)
- `worker.index` (worker-scoped metrics)
- `queue.policy` (queue-scoped metrics)
- `queue.max_in_flight`, `queue.max_depth` (optional)

## Performance measures

When spans are enabled and sampled:

- Each task call emits `performance.measure('atelier:span', ...)`.
- `trace.end()` emits `performance.measure('atelier:trace', ...)`.

These measures are best-effort. Browsers may drop entries or omit `detail`.
Use `PerformanceObserver` for profiling and DevTools integration, and rely on
`subscribeEvents()` for reliable data.

## Why no built-in OpenTelemetry dependency

We align with OTel concepts (trace, span, status, attributes) but intentionally
avoid a core OTel dependency:

- Browser OTel is experimental and a moving target.
- Context propagation in the browser often relies on Zone.js.
- Pulling in OTel packages increases bundle size and complexity for all users.

The event stream is designed so users can build adapters or exporters without
bundling OTel into the core runtime.
