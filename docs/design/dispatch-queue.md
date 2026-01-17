# Dispatch Queue

`DispatchQueue` is the admission controller used by both executors. It bounds
accepted work, keeps worker message queues predictable, and provides clear state
for observability. It does not provide pipeline-level scheduling, and it cannot
prevent memory growth if large payloads are allocated before admission.

## Limits and policies

The queue enforces two limits: `maxInFlight` (dispatched calls) and
`maxQueueDepth` (accepted but not yet dispatched). When `maxQueueDepth` is
reached, a policy determines what happens next:

- `block`: wait at the call site until capacity exists.
- `reject`: reject immediately.
- `drop-latest`: reject the incoming entry.
- `drop-oldest`: evict the oldest pending entry and accept the new one.

Under the `block` policy, callers wait in FIFO order. When a pending entry
leaves the queue (dispatch, cancel, drop), a permit is released to the next
waiter. Waiting callers hold only a Promise and an optional AbortSignal listener;
there is no overflow queue.

## State model

Each call moves through three phases: `waiting` (call-site paused before
admission), `pending` (accepted but not dispatched), and `in-flight` (running
on a worker). Queue wait time is measured from call time to dispatch, including
any waiting.

## Cancellation and crash recovery

Cancellation can occur while waiting, queued, or in-flight. In-flight
cancellation uses worker `__cancel(callId)` and relies on cooperative handlers.
When workers crash with a requeue policy, in-flight entries are moved back to
pending, their attempt counters are incremented, and any stale completions from
terminated workers are ignored.

## Observability hooks

`DispatchQueue` emits payload-aware hooks for counters and spans
(`onDispatch`, `onReject`, `onCancel`) and a state hook (`onStateChange`) for
queue gauges. Executing code should keep these handlers fast; they run
synchronously on the main thread.
