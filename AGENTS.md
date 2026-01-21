# Atelier Agents Guide

This file captures repo-specific instructions and context for coding agents.
Keep it concise, practical, and aligned with how the library is structured.

## What this repo is

Atelier is a browser-only task runtime for Web Worker orchestration. It provides:
- Task runtime (`createTaskRuntime`) with per-task executors.
- Executors: `WorkerPool` (parallel) and `SingletonWorker` (serialized).
- Backpressure via `DispatchQueue`.
- Keyed cancellation via `AbortTaskController`.
- Crash recovery policies.
- Runtime-scoped observability (state + event stream + optional measures).

## How the repo is laid out (avoid brittle paths)

- This is a workspace repo. Use the root `package.json` workspaces list to find packages.
- The library package is the one whose `package.json` name is `@varunkanwar/atelier`.
  - Source lives in that package’s `src/`.
  - Tests live alongside in `tests/`.
  - Build output is `dist/`.
- Apps live in workspace `apps/`.
- Docs live under `docs/`; design notes live under `docs/design/` (search by title).

## Core modules (search by symbol name)

- `createTaskRuntime`: runtime registry, observability wiring, trace helpers.
- `defineTask` / `createDefineTask`: task proxy creation, dispatch envelope, `task.with`.
- `WorkerPool` / `SingletonWorker`: executors, worker lifecycle, crash policy handling.
- `DispatchQueue`: admission control, queue policies, wait/queue/in-flight states.
- `createTaskWorker`: worker harness providing `__dispatch` / `__cancel`.
- `parallelLimit` / `yieldAsCompleted`: pipeline-level flow control.
- `AbortTaskController`: keyed cancellation store.
- `WorkerCrashedError`: crash semantics + observability classification.

## Dispatch flow (main thread → worker)

1) `defineTask` builds an executor and returns a Proxy.
2) Proxy method call → `executor.dispatch(...)`.
3) `DispatchQueue` enforces backpressure (waiting → pending → in-flight).
4) Executor calls worker `__dispatch` (Comlink), with transferables applied.
5) Completion resolves/rejects the call; requeues bump attempt counters so stale
   completions are ignored.

## Backpressure & queue semantics

- Queue states: `waiting` (call-site paused), `pending` (accepted, not started),
  `in-flight` (running on worker).
- Policies: `block` waits at the call site; `reject` / `drop-*` load shed.
- `block` uses permits; waiting callers hold only a Promise + optional AbortSignal.
- Queue wait time includes waiting + pending time.

## Cancellation & timeouts

- Keyed cancellation uses `AbortTaskController` + `keyOf` on tasks or `keyOf` in
  `parallelLimit`.
- Phases: `waiting`, `queued`, `in-flight` (in-flight uses worker `__cancel`).
- `timeoutMs` creates an AbortSignal for a dispatch; treat it like cancellation.

## Crash recovery

- Crash policies control whether in-flight work fails or requeues after a crash.
- Requeued entries bypass admission to avoid deadlocks; attempt counts increment.
- `WorkerCrashedError` is a first-class error kind in observability.

## Observability

- State snapshots (`getRuntimeSnapshot`) are authoritative for current state.
- Event stream (`subscribeEvents`) is canonical for metrics/spans/traces.
- Spans are opt-in; events are emitted only when listeners exist.
- Avoid in-library aggregation (p50/p95/etc).

## Transferables

- Default is automatic zero-copy transfer; override with `transfer` and
  `transferResult`.
- Transfers move ownership; buffers are detached on the sender.

## Tests

- Unit, integration, and perf tests live under the library package `tests/`.
- Use the fake-worker helpers for crash/cancel scenarios.
- Update tests for any executor/queue/cancellation semantics change.

## Common pitfalls

- `task.with(...)` is reserved for dispatch options; don’t add conflicting props.
- Worker APIs rely on `__dispatch` / `__cancel` from the harness.
- Queue policy semantics are subtle; keep states and hooks consistent.
- Avoid Node-only APIs; the runtime is browser-first.
