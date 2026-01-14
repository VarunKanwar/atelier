# Executors

Atelier provides two executors that share common queue semantics but differ in
worker topology and lifecycle.

## WorkerPool (parallel)

- Fixed-size pool of workers.
- Dispatch uses round-robin selection.
- Per-worker in-flight counts are tracked for diagnostics.
- Suitable for CPU-bound or parallelizable workloads.

## SingletonWorker (serialized)

- Single worker instance.
- Defaults to `maxInFlight = 1` to serialize calls.
- Suitable for GPU-bound or resource-constrained workloads.

## Lifecycle

Both executors support:

- `startWorkers()` to resume processing.
- `stopWorkers()` to pause and requeue in-flight work.
- `dispose()` to reject all work and terminate workers.
- optional `idleTimeoutMs` to auto-terminate when idle.

## Dispatch path

Executors enqueue work via `DispatchQueue` and then call the worker harness
method `__dispatch(callId, method, args, key)` to ensure cancellation is
cooperative.

Transfer behavior is handled at the executor boundary; see
`transferables.md` for details.
