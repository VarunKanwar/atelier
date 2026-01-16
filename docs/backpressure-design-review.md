# Atelier Queue and Flow Control Specification

## Status
Proposed.

## Executive Summary
Atelier's queue system must provide predictable per-task behavior without implying pipeline backpressure that it cannot deliver. This spec replaces the current "blocked" overflow queue with true call-site waiting for `block`, keeps load-shedding policies, and makes pipeline flow control explicit via `parallelLimit` (reserve-then-build pattern). The result is bounded worker queues, clearer observability, and safer defaults while preserving crash recovery and cancellation semantics.

## Problem Statement
The current queue implementation conflates two concerns:

1) Load shedding (rejecting or dropping work when a queue is full)
2) Flow control (slowing producers so work matches consumer rate)

The existing `block` policy does not create pipeline backpressure. It pushes overflow into an unbounded `blocked` queue, which:
- makes `maxQueueDepth` misleading (not a true bound)
- allows unbounded memory growth
- provides a false sense of safety

Without pipeline topology awareness, per-task queues cannot propagate backpressure across a pipeline. Flow control must be explicit at the call site.

## Goals
- Provide bounded, predictable per-task queue behavior.
- Keep worker message queues bounded.
- Preserve crash recovery and cancellation semantics.
- Maintain useful, accurate observability metrics.
- Make pipeline flow control explicit and documented.

## Non-goals
- Automatic backpressure across multi-task pipelines without topology awareness.
- Preventing all intermediate result accumulation under `Promise.all`.

## Design Overview

### Key Concepts
- **pending**: accepted work ready to dispatch
- **inFlight**: currently executing work
- **waiting**: callers waiting for capacity before work is accepted

### Queue Policies
- `block`: wait at the call site until capacity exists, then accept
- `reject`: reject immediately when pending is at capacity
- `drop-oldest`: evict the oldest pending entry, accept the new entry
- `drop-latest`: drop the incoming entry

### Default Behavior
- `queuePolicy` defaults to `block`
- `maxQueueDepth` defaults to:
  - parallel: `maxInFlight * 2` (typically `poolSize * 2`)
  - singleton: `2`
- `maxQueueDepth` may be set to `Infinity` to explicitly opt out of bounds.

These defaults provide bounded queues without requiring user configuration, while allowing opt-out for advanced cases.

### Admission Algorithm (`block`)
1) On `enqueue`, if `pending.length >= maxQueueDepth`, await a capacity permit (FIFO).
2) After a permit is acquired, create and enqueue the entry.
3) When an entry is removed (completion, cancellation, or rejection), release capacity.

Notes:
- There is no overflow queue; waiting callers hold only a Promise and optional AbortSignal listener.
- `queueWaitMs` should start at call time (before waiting) to represent true time-to-dispatch.

### Load Shedding (`reject` / `drop-*`)
If the queue is at capacity:
- `reject`: reject immediately with `QueueDropError` (policy = `reject`)
- `drop-oldest`: remove the oldest pending entry, reject it, then enqueue the new entry
- `drop-latest`: reject the incoming entry

No waiting occurs for load-shedding policies.

### Crash Recovery Interaction
`requeueInFlight()` re-inserts entries that were already accepted. Requeued entries are not subject to admission limits to avoid deadlocks. They are placed at the front of `pending` to preserve liveness and keep retry semantics intact.

### Cancellation Semantics
Cancellation phases:
- `waiting`
- `queued`
- `in-flight`

Abort while waiting removes the waiter and rejects with `AbortError`.

### Observability
Queue state:

```
type DispatchQueueState = {
  inFlight: number
  pending: number
  waiting: number
  maxInFlight: number
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  paused: boolean
  disposed: boolean
}
```

Metrics:
- `queue.in_flight` (gauge)
- `queue.pending` (gauge)
- `queue.waiting` (gauge)
- `queue.wait_ms` (histogram) includes waiting + pending time

## Pipeline Flow Control (Explicit)
Queues do not provide pipeline backpressure. To bound pipeline memory and intermediate results, use call-site concurrency control with `parallelLimit`, and ensure heavy allocations happen inside the limit.

Example (reserve-then-build pattern):

```ts
for await (const result of parallelLimit(files, 8, async file => {
  const image = await decode(file) // heavy allocation inside the limit
  const resized = await resize.process(image)
  return analyze.process(resized)
})) {
  results.push(result)
}
```

This pattern ensures only `N` large payloads exist at once, which protects memory in large batches (e.g., 1000 photos).

## Why Queueing Still Matters With Comlink
Comlink provides per-worker message queues, but Atelier still adds value:
- pool-level scheduling across workers
- crash recovery (requeue or fail)
- keyed cancellation across queued/in-flight work
- per-task observability (depth, wait time, drops)
- explicit load shedding policies
- bounded worker queues (avoid unbounded message backlog)

## API Changes

### Types
```
type QueuePolicy = 'block' | 'reject' | 'drop-oldest' | 'drop-latest'
```

### State Shape
- `blocked` is removed
- `waiting` is added
- `blockedQueueDepth` becomes `waitingQueueDepth` in snapshots

### Defaults
- `queuePolicy` defaults to `block`
- `maxQueueDepth` defaults to a finite value (see Default Behavior)

## Implementation Plan

### 1) DispatchQueue
- Remove `blocked` array entirely.
- Add FIFO `capacityWaiters`.
- Implement `waitForCapacity(signal)` for `block` policy.
- Start `enqueuedAt` at call time (to include waiting time).
- Update cancellation handling to include `waiting`.
- Update `isIdle()` to include waiting.

### 2) Executors
- Update queue gauge emission:
  - add `queue.waiting`
  - remove `queue.blocked`
- Update state mapping:
  - `waitingQueueDepth` replaces `blockedQueueDepth`

### 3) Observability Demo
- Rename "Blocked" to "Waiting" in the UI.
- Update any chart labels or metrics usage.

### 4) Tests
- Add unit tests for:
  - `block` waits at call site
  - FIFO ordering for waiters
  - abort while waiting
  - `queue.wait_ms` includes waiting time
- Update integration tests to use `waiting` instead of `blocked`.

### 5) Docs
- Update README and API reference to reflect:
  - `block` semantics
  - defaults
  - explicit pipeline flow control

## Migration Notes
- `blockedQueueDepth` removed; use `waitingQueueDepth`.
- Cancellation phases now include `waiting`.
- Default `maxQueueDepth` is finite and may reduce throughput unless tuned.

## Open Questions
- Do we want a global runtime-level default for `maxQueueDepth`?
- Should `queue.wait_ms` be split into `waiting_ms` and `pending_ms` for clarity?
- Should requeued entries be inserted at front (current plan) or end (fairness)?
