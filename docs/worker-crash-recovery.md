# Atelier: Worker Crash Detection and Recovery

Status: Draft (VAR-65)

## Problem

Atelier assumes workers stay alive for the lifetime of a task. Today, if a
worker crashes (error event, messageerror, or unexpected termination), the
runtime has no structured response. The most common failure mode is a stuck
pipeline:

- A call is marked in-flight in `DispatchQueue`.
- The worker dies before it can reply.
- The in-flight promise never resolves or rejects.
- `maxInFlight` prevents further dispatch, so the queue stops draining.
- Telemetry and snapshots show an “active” task with no forward progress.

This is particularly painful for singleton workers, but a pool can also stall if
all workers crash or if a hung in-flight call consumes the entire concurrency
limit.

### Example

A singleton worker runs LLM inference for a document. The worker throws an
unhandled exception or hits an out-of-memory condition and terminates. The
runtime still believes one call is in-flight, so all subsequent requests remain
blocked behind `maxInFlight = 1`. The UI shows a perpetual “processing” state and
cancellation no longer helps because the in-flight work never settles.

We need to detect crashes, surface them, and choose a deterministic recovery
strategy so the task runtime cannot silently deadlock.

## Goals

- Detect worker crashes and surface them in telemetry and runtime snapshots.
- Ensure in-flight work does not remain unresolved after a crash.
- Provide an explicit, per-task recovery policy.
- Keep the API surface small and opinionated.

## Non-goals

- Guarantee exactly-once execution after a crash.
- Automatically retry side-effecting work without opt-in.
- Persist or recover queued work across page reloads.

## Proposed Design

### Crash detection

Attach crash listeners to each Worker instance when it is created:

- `worker.addEventListener('error', ...)`
- `worker.addEventListener('messageerror', ...)`

These listeners mark the worker as crashed and initiate recovery. Intentional
termination (when `stopWorkers`, `dispose`, or idle timeouts terminate the
worker) is not considered a crash and does not trigger recovery logic.

### Crash handling

When a worker crashes:

1. Record crash metadata (task id, worker index, error, timestamp).
2. Release the Comlink proxy and terminate the worker instance.
3. Resolve or requeue in-flight calls for that worker (policy-dependent).
4. Optionally start a fresh worker (policy-dependent).

To prevent deadlocks, all in-flight calls tied to the crashed worker must settle
(either rejected or requeued). Pending and blocked work remain in the queue and
are handled by the recovery policy.

### Recovery policy

Add a per-task configuration option to make recovery explicit:

```
crashPolicy?: 'restart-fail-in-flight' | 'restart-requeue-in-flight' | 'fail-task'
crashMaxRetries?: number
```

`crashMaxRetries` caps how many crashes are tolerated before the policy escalates
to `fail-task`. Default: `3` for restart policies; ignored for `fail-task`.

We also apply a small internal restart backoff for restart policies to avoid
tight crash loops. This is not configurable in v1; it starts at 100ms and
exponentially backs off up to a 2s cap, and resets after a successful dispatch
completes or a clean worker shutdown.

Behavior:

- `restart-fail-in-flight` (default):
  - Reject in-flight calls assigned to the crashed worker with
    `WorkerCrashedError`.
  - Restart the worker and keep the queue running.
  - Pending work stays queued and continues once capacity is available.
  - If `crashMaxRetries` is exceeded, escalate to `fail-task`.

- `restart-requeue-in-flight`:
  - Requeue the in-flight calls from the crashed worker back into the
    `DispatchQueue`.
  - Restart the worker and continue.
  - Intended only for idempotent work where replay is safe.
  - If `crashMaxRetries` is exceeded, escalate to `fail-task`.

- `fail-task`:
  - Reject all in-flight, pending, and blocked work with `WorkerCrashedError`.
  - Stop the task’s workers and require an explicit restart (or task re-creation).

Singleton tasks use the same policy. In pool tasks, the policy applies only to
calls that were in-flight on the crashed worker; other workers continue running.

### Errors

Introduce a dedicated error type for callers to recognize:

```
class WorkerCrashedError extends Error {
  name = 'WorkerCrashedError'
  taskId: string
  workerIndex?: number
  cause?: unknown
}
```

This prevents crash errors from being conflated with aborts or task-level
rejections.

### Observability changes

- Add a new telemetry event: `worker:crash` with the error and worker index.
- Extend `WorkerState` to include crash information:
  - `workerStatus` gains a `crashed` state.
  - `lastCrash?: { ts: number; error?: unknown; workerIndex?: number }`.

The runtime snapshot should reflect crash state immediately, even if recovery
restarts the worker afterward.

We intentionally do not add a new `onCrash` hook; telemetry + snapshots should be
the single observability surface for this.

## Implementation Outline

- `worker-pool.ts` / `singleton-worker.ts`
  - Attach crash listeners when a Worker is created.
  - Track whether termination is intentional to avoid false positives.
  - Track crash count per task and reset it on clean shutdown.
  - Track per-task restart backoff and reset on successful dispatch or clean shutdown.
  - On crash, call a shared handler that:
    - rejects or requeues in-flight work for that worker,
    - records telemetry,
    - restarts or halts based on `crashPolicy`.

- `dispatch-queue.ts`
  - Add internal helpers to reject or requeue in-flight entries by predicate
    (e.g., by `callId`). This is necessary to settle only the calls associated
    with a crashed worker.

- `types.ts`
  - Add `crashPolicy` to `TaskConfig`.
  - Add `crashMaxRetries` to `TaskConfig` (only used by restart policies).
  - Extend `WorkerState` with crash metadata.
  - Add `worker:crash` to `TaskEventType`.

- `telemetry.ts`
  - Record last crash error/time in the telemetry store.

## Tradeoffs

- **Default fail-in-flight** avoids silent duplication but can surface more
  errors to callers after a crash.
- **Requeue-in-flight** improves throughput but is unsafe for non-idempotent
  work.
- **Fail-task** is safest for correctness but stops the pipeline until manual
  intervention.

The default `restart-fail-in-flight` is a reasonable balance for an internal
system: it surfaces crashes, avoids duplicate side effects, and keeps the
pipeline moving.
