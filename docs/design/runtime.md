# Runtime Scope and Dispatch Flow

## Runtime scope

`createTaskRuntime()` returns an isolated runtime instance that owns:

- a task registry
- a keyed cancellation domain (`AbortTaskController`)
- observability helpers (snapshots + event stream + optional spans)

This keeps cancellation and observability scoped and avoids hidden global state.

## Task creation

Tasks are created with `runtime.defineTask({ ... })` and backed by one of two
executors:

- `WorkerPool` for parallelizable work
- `SingletonWorker` for serialized work

## Dispatch flow

1. Caller optionally scopes dispatch options via `task.with(options)`.
2. Caller invokes `task.method(...)` on the main thread.
3. `defineTask` derives a cancellation key (if `keyOf` is set).
4. A dispatch signal is composed from key-based cancellation and `timeoutMs`.
5. The executor enqueues the dispatch via `DispatchQueue`.
6. The executor calls the worker harness method
   `__dispatch(callId, method, args, key)`.

Dispatch options are not passed to worker handlers; they remain part of the
runtime envelope (transfer policy, cancellation, tracing, etc.).

## Task proxy

Tasks are proxy objects with three categories of behavior:

- worker methods (proxied via Comlink)
- dispatch configuration (`task.with({ ... })`)
- lifecycle helpers (`getState`, `startWorkers`, `stopWorkers`, `dispose`)

`with(...)` is reserved for dispatch options and is not forwarded to worker
handlers.
