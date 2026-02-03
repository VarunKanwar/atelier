# Backpressure and queue states

Every task dispatch goes through a `DispatchQueue` that enforces two limits:
`maxInFlight` (currently dispatched) and `maxQueueDepth` (accepted but not yet
sent to a worker). The queue is per task, so tuning is localized.

## Queue states

A call moves through three phases:

- `waiting`: call-site is blocked because the queue is full (block policy).
- `pending`: accepted but not yet dispatched to a worker.
- `in-flight`: currently running in a worker.

Queue wait time includes both `waiting` and `pending` time.

## Policies

When the pending queue hits `maxQueueDepth`, the policy decides what happens:

- `block`: wait at the call site until capacity is available.
- `reject`: reject immediately.
- `drop-latest`: reject the incoming entry.
- `drop-oldest`: evict the oldest pending entry and accept the new one.

Under `block`, callers only hold a Promise and a listener; there is no hidden
overflow queue.

## Tuning example

```ts
const runtime = createTaskRuntime()

const resize = runtime.defineTask<ResizeAPI>({
  type: 'parallel',
  worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 6,
  maxInFlight: 6,
  maxQueueDepth: 12,
  queuePolicy: 'block',
})
```

Guidelines:

- Start with defaults, then adjust `maxInFlight` for CPU pressure.
- Increase `maxQueueDepth` only if you can tolerate extra memory.
- Prefer `drop-oldest` for live feeds and `reject` for strict APIs.

## Inspecting queue state

Tasks expose `getState()` for diagnostics:

```ts
const state = resize.getState()
// state.queueDepth, state.pendingQueueDepth, state.waitingQueueDepth
```
