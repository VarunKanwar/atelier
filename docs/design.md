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

Atelier auto-detects transferable objects in arguments and results using the
`transferables` library, enabling zero-copy transfers by default. Explicit
control is provided via dispatch options:

- `task.with({ transfer: [...] })` to specify an explicit list (or `[]` to disable)
- `task.with({ transferResult: false })` to keep results in the worker

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
