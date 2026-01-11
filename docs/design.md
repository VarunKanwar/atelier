# Atelier Design

## Overview

Atelier is a small task runtime that treats tasks as the primary unit of
execution. It focuses on predictable backpressure, keyed cancellation, and
simple runtime-scoped observability.

This document explains the architecture and the main design decisions.

## Architecture

### Runtime scope

`createTaskRuntime()` returns a runtime instance that owns:

- a task registry for known tasks
- a keyed cancellation domain (`AbortTaskController`)
- snapshot helpers for observability

This keeps cancellation and observability scoped and avoids hidden global state.

### Task execution

A task is created with `runtime.defineTask` and backed by one of two executors:

- `WorkerPool` for parallelizable work
- `SingletonWorker` for serialized work

Both executors share a `DispatchQueue` that enforces:

- `maxInFlight` (in-flight limit)
- `maxQueueDepth` (pending limit)
- `queuePolicy` (`block`, `reject`, `drop-latest`, `drop-oldest`)

### Dispatch flow

1. Caller optionally scopes dispatch options via `task.with(options)`.
2. Caller invokes `task.method(...)` on the main thread.
3. `defineTask` derives a cancellation key (if `keyOf` is set).
4. A dispatch signal is composed from key-based cancellation and `timeoutMs`.
5. The executor enqueues the dispatch via `DispatchQueue`.
6. The executor calls the worker harness method `__dispatch(callId, method, args, key)`.

Dispatch options are not passed to worker handlers; they remain part of the
runtime envelope (transfer policy, cancellation, tracing, etc.).

### Worker harness

The worker harness created by `createTaskWorker(handlers)` provides:

- a per-call `AbortController`
- a `TaskContext` injected as the final handler argument
- a `__cancel(callId)` method to abort in-flight work

Handlers are expected to cooperate with cancellation by checking
`ctx.signal` or calling `ctx.throwIfAborted()`.

### Transferables

Atelier defaults to zero-copy transfer for large payloads to avoid structured
clone overhead. Transfers are a move of ownership: the sender’s buffers become
detached (“neutered”), so treat transferred objects as consumed.

Detection and control:
- Auto-detect transferables from arguments and results via the `transferables` library.
- `task.with({ transfer: [...] })` supplies an explicit list; `[]` disables transfer.
- `task.with({ transferResult: false })` keeps results in the worker.

Auto-detection flow (simplified):

```ts
const transferables = options?.transfer ?? getTransferables(args)
const result = await workerDispatch(callId, method, args, transferables)

const shouldTransferResult = options?.transferResult ?? true
if (shouldTransferResult && result != null) {
  const resultTransferables = getTransferables(result)
  if (resultTransferables.length > 0) {
    transfer(result, resultTransferables)
  }
}
```

Comlink integration:
- `transfer(obj, list)` tags objects in a `WeakMap`.
- Comlink uses the tagged list when it performs `postMessage`.

Edge cases and tradeoffs:
- Circular references are handled by `transferables` via `WeakSet`.
- Deep nesting is bounded (default depth limit of 10) to cap traversal cost.
- Shared buffers across args are deduplicated.
- `SharedArrayBuffer` is not transferable (already shared).
- Small objects incur minimal overhead; large objects benefit the most.

Default rationale:
- `transferResult: true` matches typical stateless processing.
- Stateful workers can opt out with `task.with({ transferResult: false })`.

Performance characteristics (illustrative):

| Data Size | Clone Time | Transfer Time | Savings |
|-----------|------------|---------------|---------|
| 1MB       | ~5ms       | ~0.001ms      | 5,000x  |
| 10MB      | ~50ms      | ~0.001ms      | 50,000x |
| 100MB     | ~500ms     | ~0.001ms      | 500,000x|

References:
- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [transferables library](https://github.com/okikio/transferables)
- [Comlink transfer documentation](https://github.com/GoogleChromeLabs/comlink#transfer-handlers-and-event-listeners)

### Worker crash recovery

Workers can crash (error/messageerror). Each task config declares a
`crashPolicy` that determines whether to restart and how to handle in-flight
work. Crashes are surfaced in telemetry (`worker:crash`) and via `lastCrash`
in the task state snapshot. Restarts apply a small internal backoff to avoid
tight crash loops.

### Keyed cancellation

Cancellation uses a runtime-scoped `AbortTaskController`:

- each key maps to an `AbortSignal`
- `abort(key)` cancels all queued and in-flight work for that key
- `clear(key)` removes key state to avoid unbounded maps

Keyed cancellation is applied in three places:

1. **Queue-level**: `DispatchQueue` rejects pending work when the signal aborts.
2. **Worker-level**: in-flight work is canceled via `__cancel(callId)`.
3. **Pipeline-level**: `parallelLimit` skips scheduling canceled items and drops
   results for aborted keys by default.

### Pipeline scheduling

`parallelLimit` provides pipeline-level backpressure. When cancellation options
are provided, it:

- skips scheduling items whose key is already aborted
- treats `AbortError` as non-fatal
- drops results at yield-time for aborted keys

This prevents downstream code from accidentally acting on canceled results.

## Observability

Each task exposes `getState()` with queue and worker metrics. The runtime registry
aggregates those into a `RuntimeSnapshot` via `getRuntimeSnapshot()` or
`subscribeRuntimeSnapshot()`.

For latency percentiles and queue wait distributions, an optional
`createTelemetryStore()` can be attached per task.

## Tradeoffs

- **Cooperative cancellation**: in-flight work stops only if handlers cooperate.
- **No global scheduler**: tasks are independent; cross-task fairness is not
  provided.
- **No durable queues**: state is in-memory and reset on refresh.

## Rationale (selected)

- **Runtime-scoped registry** avoids implicit global behavior and supports
  isolated runtimes.
- **Keyed cancellation** keeps cancellation uniform and avoids bespoke predicates.
- **Worker harness** centralizes cancellation and avoids per-handler boilerplate.
- **Minimal API** reduces surface area and makes intended usage explicit.
