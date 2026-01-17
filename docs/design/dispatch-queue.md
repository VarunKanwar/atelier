# Dispatch Queue

`DispatchQueue` provides shared admission control and queue semantics for both
executors (`WorkerPool` and `SingletonWorker`). It bounds accepted work, keeps
worker message queues predictable, and exposes clear state for observability.

## Goals

- Bound accepted work per task with explicit policies.
- Keep worker message queues bounded and observable.
- Preserve crash recovery and cancellation semantics.

## Non-goals

- Pipeline-level backpressure across multiple tasks.
- Preventing memory growth when large payloads are allocated before admission.

## Limits

- `maxInFlight`: maximum number of calls dispatched to workers.
- `maxQueueDepth`: maximum number of pending calls waiting to dispatch.

## Queue policies

When `maxQueueDepth` is reached:

- `block`: wait at the call site for capacity (default).
- `reject`: reject immediately.
- `drop-latest`: reject the incoming entry.
- `drop-oldest`: evict the oldest pending entry, accept the new one.

## Queue states

Each call is in one of three states:

- `waiting`: the caller is paused before the runtime accepts the work.
- `pending`: accepted and queued, waiting to dispatch.
- `in-flight`: dispatched to a worker.

## Admission (`block` policy)

`block` implements true call-site waiting:

1) If `pending.length >= maxQueueDepth`, wait for a capacity permit (FIFO).
2) Once a permit is acquired, enqueue the entry.
3) When a pending entry leaves the queue (dispatch, cancel, drop), release a
   permit to the next waiter.

There is no overflow queue. Waiting callers hold only a Promise and (optionally)
an AbortSignal listener.

## Load shedding (`reject` / `drop-*`)

No waiting occurs for load-shedding policies:

- `reject`: reject immediately with `QueueDropError`.
- `drop-latest`: reject the incoming entry.
- `drop-oldest`: evict the oldest pending entry, reject it, and enqueue the new
  entry.

## Cancellation phases

Cancellation can occur in three phases:

- `waiting`: caller aborted before enqueue.
- `queued`: pending entry removed before dispatch.
- `in-flight`: dispatched entry canceled via `__cancel(callId)`.

## Crash recovery and requeue

When a worker crashes with a requeue policy, in-flight entries are moved back to
pending and the attempt counter is incremented. Requeued entries bypass
admission to avoid deadlocks and are inserted at the front of the queue. Any
completion from the terminated worker is ignored.

## Observability hooks

`DispatchQueue` emits two classes of signals:

- **payload-aware hooks** (`onDispatch`, `onReject`, `onCancel`) for counters,
  histograms, and span classification.
- **state-only hook** (`onStateChange`) for queue gauges on every state change.

Queue wait time is measured from call time (including any waiting) to dispatch,
using the same `now()` utility as span timing.

## Practical meaning for app developers

- **In flight**: work is running on a worker (active CPU time).
- **Pending**: accepted but not started. The runtime holds the payload, so
  memory use and end-to-end latency grow with backlog size.
- **Waiting**: the caller is paused before the runtime accepts the work. Use
  this as a signal to limit upstream concurrency or defer large allocations
  until capacity is available.
