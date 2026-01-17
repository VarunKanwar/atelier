# Dispatch Queue

`DispatchQueue` provides shared backpressure semantics for both executors.

## Limits

- `maxInFlight`: maximum number of calls dispatched to workers.
- `maxQueueDepth`: maximum number of pending calls waiting to dispatch.

## Queue policies

When `maxQueueDepth` is reached:

- `block`: wait at the call site for capacity (default)
- `reject`: reject immediately
- `drop-latest`: reject newest
- `drop-oldest`: evict oldest pending entry, accept new

## Queue states

Each entry is in one of three states:

- `pending`: enqueued and waiting to dispatch
- `waiting`: callers waiting for capacity before enqueue
- `in-flight`: dispatched to a worker

## Cancellation phases

Cancellation can occur in three phases:

- `waiting`: caller aborted before enqueue
- `queued`: pending entry removed
- `in-flight`: dispatched entry canceled via `__cancel(callId)`

## State change hooks

`DispatchQueue` emits two classes of signals:

- **payload-aware hooks** (`onDispatch`, `onReject`, `onCancel`) used for
  counters, histograms, and span classification.
- **state-only hook** (`onStateChange`) used to emit queue gauges whenever
  queue state mutates (enqueue, dequeue, dispatch, completion, cancel, requeue).

This keeps gauges accurate without requiring payload information.

## Attempts and requeue

When a worker crashes with a requeue policy, in-flight entries are moved back to
pending and the attempt counter is incremented. Any completion from the
terminated worker is ignored.

## Queue wait timing

Queue wait is measured per dispatch attempt from call time (before capacity
waiting) to dispatch time using the same `now()` utility as span timing to keep
measurements consistent.
