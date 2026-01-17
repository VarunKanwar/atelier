# Observability Design

Atelier exposes observability through three surfaces: state snapshots, an event
stream, and optional Performance API measures. The intent is explicitness and
low overhead: nothing is emitted unless you opt in, and there is no in-library
aggregation.

## Surfaces and configuration

State is queryable at any time via `getRuntimeSnapshot()` or
`subscribeRuntimeSnapshot()`. The event stream (`subscribeEvents`) is the
canonical record for metrics, spans, and traces. Performance measures are
best-effort and intended for profiling and devtools integration.

Spans are opt-in via `createTaskRuntime({ observability: { spans } })`. The
default is `spans: 'auto'`, which enables spans in dev and disables them in
production. Sampling is trace-level when a trace is present; otherwise it uses
the span id. Events are emitted only when listeners are registered.

## Traces and spans

Tracing is explicit. Create a trace with `runtime.createTrace(name?)` or
`runtime.runWithTrace(name, fn)`, then attach it to calls with
`task.with({ trace })`. There is no implicit propagation and no span hierarchy.
A trace represents a workflow instance; each task call is a span.

A span measures a single task call from dispatch request to completion. It
tracks attempt counts (requeues), queue wait time, and end status (`ok`,
`error`, `canceled`). Queue drops end spans immediately with `errorKind: 'queue'`.
`WorkerCrashedError` is classified as `errorKind: 'crash'`, and aborts are
classified as `errorKind: 'abort'`.

## Events, metrics, and measures

The event stream delivers counters, gauges, histograms, spans, and traces. It
is synchronous and best-effort; listener errors are swallowed, so keep handlers
fast. Spans and traces are emitted only when spans are enabled and sampled.

Metrics emitted today:

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
- `queue.waiting`
- `workers.active`

Histograms:
- `task.duration_ms`
- `queue.wait_ms`

When spans are enabled and sampled, each call also emits a
`performance.measure('atelier:span', ...)`, and `trace.end()` emits
`performance.measure('atelier:trace', ...)`. These measures are best-effort and
may be dropped or have missing `detail` in some browsers.
