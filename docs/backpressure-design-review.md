# Atelier Backpressure Design Review

## Executive Summary

While building a demo application to showcase Atelier's features, we discovered that the "backpressure" implementation does not behave as users would expect based on how similar systems (Ray Data, Flink, etc.) handle backpressure. This document captures the issue, our research findings, and open questions about Atelier's design and value proposition.

---

## 1. The Issue We Encountered

### Demo Setup

We built an image processing pipeline demo with three stages:

```
Resize (parallel, 4 workers) → Analyze (singleton, 1 worker) → Enhance (singleton)
```

Configuration:
- 40 images to process
- `maxQueueDepth: 8` on the Analyze task
- `queuePolicy: 'block'`
- Pipeline concurrency: unlimited (all 40 images start processing at once)

### Expected Behavior

With a queue depth of 8 and `block` policy, we expected:
- Analyze accepts 8 items into its queue
- When full, upstream (Resize) should slow down or stop
- Backpressure propagates through the pipeline
- System processes at the rate of the slowest stage

### Actual Behavior

- Resize (4 parallel workers) quickly processes all 40 images
- All 40 resized images immediately attempt to enqueue to Analyze
- Analyze's `pending` queue fills to 8
- Remaining ~32 items go into a separate `blocked` queue
- The `blocked` queue grows unboundedly
- Resize is completely unaware that Analyze is overwhelmed

### Root Cause

Atelier's `DispatchQueue` has **two separate queues**:

1. **`pending`**: Bounded by `maxQueueDepth`, items ready to dispatch to workers
2. **`blocked`**: Unbounded, holds items waiting for `pending` capacity

When `queuePolicy: 'block'` is set and `pending` is full, new items go into `blocked`. The caller's promise remains unresolved until the item eventually completes, but the item is already tracked in memory.

This means `maxQueueDepth: 8` actually means "8 items ready to dispatch, plus unlimited items waiting." The bound is not a true bound.

---

## 2. Research: How Other Systems Handle Backpressure

### Ray Data

Ray Data is a distributed data processing library that achieves automatic backpressure without requiring explicit pipeline declarations.

**Key mechanisms:**

1. **Implicit DAG Construction**: Users write fluent method chains (`ds.map(f).filter(g).map(h)`), and Ray internally constructs an execution graph. This gives the system visibility into the full pipeline topology.

2. **Queue-Based Propagation**: Each operator has output queues. When a downstream operator's queue fills, the system stops scheduling work for upstream operators.

3. **Composable Backpressure Policies**:
   - `ConcurrencyCapBackpressurePolicy`: Limits concurrent tasks per operator
   - `ResourceBudgetBackpressurePolicy`: Tracks CPU/GPU/memory budgets
   - `DownstreamCapacityBackpressurePolicy`: Monitors downstream queue ratios

4. **Streaming Execution**: Data flows as bounded blocks (1-128 MiB). Multiple stages can be active simultaneously, but each respects downstream capacity.

**Key insight**: Ray Data's backpressure works because the system knows the pipeline topology and can coordinate flow across operators. Pressure propagates automatically because the scheduler won't feed an operator whose downstream is full.

### Apache Flink

Uses **credit-based flow control**:
- Downstream operators announce buffer availability as "credits"
- Upstream operators only send data when credits are available
- Backpressure affects individual logical channels

### Dask Distributed

Uses **threshold-based worker memory management**:
- 60% memory: Begin spilling to disk
- 70% memory: More aggressive spilling
- 80% memory: **Pause** - worker stops accepting new tasks
- 95% memory: Terminate worker, reschedule tasks

### Reactive Streams (Akka, RxJava)

Uses **demand-based protocol**:
- Subscribers signal `Request(n)` for n elements
- Publishers guarantee never emitting more than requested
- Backpressure propagates through operator chains

### Browser Streams API

Uses **high water mark** mechanism:
- `desiredSize = highWaterMark - queuedChunkSize`
- When `desiredSize <= 0`, producer should slow down
- Pull-based: `pull()` signals when more data is wanted

### Common Pattern

All these systems share a key property: **backpressure propagates automatically through the pipeline topology**. When downstream is slow, upstream learns about it and slows down without explicit user intervention.

---

## 3. Why Atelier's Design Differs

### Atelier's Model

Atelier uses a **task-level abstraction**, not a pipeline abstraction:

```typescript
// Users write normal async/await code
const resized = await resizeTask.process(image)
const analyzed = await analyzeTask.process(resized)
const enhanced = await enhanceTask.process(analyzed)
```

Each task is independent. There is no declared pipeline topology. The "pipeline" exists only in user code as sequential await statements.

### The Fundamental Tension

**Ray Data approach**: System knows the topology → can coordinate flow globally

**Atelier approach**: Tasks are independent → no global coordination possible

When you call `analyzeTask.process(resized)`, the Analyze task has no idea that:
- The data came from Resize
- There are 39 more items about to arrive
- It should somehow signal Resize to slow down

### Why the Two-Queue Design Exists

The `blocked` queue exists to handle the `block` policy without truly blocking the JavaScript event loop. When you call `task.process()` and the queue is full:

1. The item goes into `blocked`
2. The promise remains pending
3. When space opens in `pending`, item moves over
4. Promise resolves when work completes

This keeps the caller "waiting" without blocking the event loop. But it means all items are held in memory, defeating the purpose of a bounded queue.

---

## 4. What Does Atelier Actually Provide?

Setting aside backpressure, Atelier provides:

### 1. Worker Pool Management
```typescript
const resize = runtime.defineTask({
  type: 'parallel',
  poolSize: 4,
  worker: () => new Worker(...)
})
```
Managing multiple workers, distributing work, handling the pool lifecycle. Without this, users would manually track which worker is free, route work, etc.

**Value: Clear and significant.**

### 2. Crash Recovery
```typescript
const task = runtime.defineTask({
  crashPolicy: 'restart-requeue-in-flight',
  crashMaxRetries: 3
})
```
When a worker crashes (OOM, unhandled error), Atelier can restart it and optionally requeue the work that was in-flight.

**Value: Clear and significant.** This is non-trivial to implement correctly.

### 3. Keyed Cancellation
```typescript
const signal = runtime.abortTaskController.signalFor('batch-1')
await task.process(data, { signal, key: 'batch-1' })
// Later:
runtime.abortTaskController.abort('batch-1')
```
Cancel groups of related tasks by key, handling items in different states (queued, in-flight).

**Value: Clear and significant.**

### 4. Idle Timeout
```typescript
const task = runtime.defineTask({
  idleTimeoutMs: 30_000
})
```
Spin down workers that haven't been used, freeing resources.

**Value: Nice to have.** Simple but useful.

### 5. Queue Management / "Backpressure"
```typescript
const task = runtime.defineTask({
  maxQueueDepth: 10,
  queuePolicy: 'block' | 'reject' | 'drop-oldest' | 'drop-latest'
})
```
Limit queue depth and control overflow behavior.

**Value: Unclear.** This is where we're stuck.

---

## 5. The Backpressure Question

### Does queue-level backpressure matter?

**Arguments for:**
- Prevents unbounded memory growth
- Enables load shedding (`reject`, `drop-*` policies)
- Provides observability into system load
- Matches user expectations from other systems

**Arguments against:**
- With Comlink, payloads are transferred to the worker (not duplicated)
- Browser message queues are unbounded anyway
- For most workloads, everything eventually completes
- User-land concurrency control (`parallelLimit`) may be sufficient

### User-Land Backpressure

The demo uses `parallelLimit` to control pipeline concurrency:

```typescript
for await (const result of parallelLimit(images, 6, processImage)) {
  // At most 6 images in the pipeline at once
}
```

When `analyzeTask.process()` is slow, the `await` naturally blocks, and no new images enter the pipeline. This IS backpressure, just at the user level rather than the task level.

**Question**: Is user-land concurrency control sufficient? Or should Atelier provide automatic propagation?

---

## 6. Design Options

### Option A: Status Quo + Documentation

Keep the current design but:
- Document that `maxQueueDepth` bounds `pending`, not total items
- Document that `block` policy uses an unbounded overflow queue
- Recommend `parallelLimit` for pipeline backpressure
- Position queue policies as "overflow handling" not "backpressure"

**Pros**: No code changes, clarifies expectations
**Cons**: Doesn't match user mental model of "backpressure"

### Option B: True Blocking on Enqueue

Remove the `blocked` queue. With `block` policy, `enqueue()` awaits capacity before accepting:

```typescript
async enqueue(payload, options) {
  if (this.queuePolicy === 'block') {
    await this.waitForCapacity(options?.signal)
  }
  // Now add to pending
}
```

Callers wait at the call site, not in a secondary queue. Memory usage is minimal (just the waiting promise, not the payload).

**Pros**: `maxQueueDepth` becomes a true bound, simpler mental model
**Cons**: Still doesn't propagate upstream automatically (requires user-land coordination)

### Option C: Pipeline Abstraction

Add an explicit pipeline API that manages flow between stages:

```typescript
const pipeline = runtime.createPipeline([
  { task: resize, concurrency: 4 },
  { task: analyze, concurrency: 1 },
  { task: enhance, concurrency: 1 }
], { bufferSize: 8 })

for await (const result of pipeline.process(images)) {
  // Backpressure handled automatically
}
```

**Pros**: Automatic backpressure propagation, matches Ray Data model
**Cons**: New abstraction, limits flexibility, can't easily do things with intermediate results

### Option D: Remove Backpressure Focus

De-emphasize backpressure as a feature:
- Keep simple queue policies for specific use cases
- Focus Atelier's value prop on: pooling, crash recovery, cancellation, idle management
- Let users handle concurrency control in their code

**Pros**: Clearer value prop, simpler library
**Cons**: Users expecting backpressure will be disappointed

---

## 7. Open Questions for Committee

1. **Is task-level backpressure a real need?** Or is user-land concurrency control (`parallelLimit`, `p-limit`, etc.) sufficient for most use cases?

2. **Should Atelier try to match Ray Data's backpressure model?** This would likely require a pipeline abstraction, which conflicts with the "write normal code" philosophy.

3. **Is the current two-queue design (`pending` + `blocked`) worth keeping?** It seems to confuse more than help.

4. **What is Atelier's core value proposition?**
   - "Easy worker pools with crash recovery and cancellation" (clear value)
   - "Automatic backpressure for browser workloads" (unclear how to deliver)

5. **Who is the target user?**
   - Someone processing a few hundred items? (User-land control is fine)
   - Someone building a data pipeline with millions of items? (Needs real backpressure, but is the browser the right environment?)

---

## 8. Recommendation

After further analysis, we recommend **automatic backpressure via sensible defaults**.

### The Key Insight

Users shouldn't need to pick magic numbers like `parallelLimit(images, 6, ...)`. Why 6? It's a guess that varies by machine.

Instead, if each task has a bounded queue with true blocking, the system self-regulates:

```typescript
// No parallelLimit needed - system adapts automatically
await Promise.all(images.map(processImage))
```

The bottleneck (e.g., singleton analyze task) naturally throttles the whole pipeline. This is how Ray Data and similar systems work.

### The Changes Required

1. **Fix `block` policy to truly block on enqueue**
   - Remove the `blocked` queue entirely
   - When queue is full, `enqueue()` awaits capacity (not tracked in memory)
   - Callers wait at the call site via async/await

2. **Set sensible default `maxQueueDepth` based on pool size**
   - Worker pool: `maxQueueDepth = poolSize * 2` (small buffer for smooth flow)
   - Singleton: `maxQueueDepth = 2` (minimal buffer)

3. **Make `block` the default policy**
   - Users get automatic backpressure out of the box
   - `reject` / `drop-*` remain available for explicit load shedding

4. **Keep queue policies for advanced use cases**
   - `reject`: Fail fast when overloaded
   - `drop-oldest` / `drop-latest`: Shed load deliberately
   - `block`: True backpressure (now the default, and actually works)

### User Experience After Changes

**Before (current):**
```typescript
// User must pick a magic number
for await (const result of parallelLimit(images, 6, processImage)) {
  // Why 6? Guess based on dev machine.
}
```

**After (proposed):**
```typescript
// System self-regulates via bounded queues
await Promise.all(images.map(processImage))

// Or for streaming results:
for (const image of images) {
  results.push(processImage(image)) // May await internally if backed up
}
await Promise.all(results)
```

### Why This Is Better Than "Just Use parallelLimit"

| Aspect | parallelLimit | Automatic Backpressure |
|--------|---------------|------------------------|
| Magic numbers | Yes (pipeline concurrency) | No (derived from pool size) |
| Adapts to machine | No (hardcoded) | Yes (pool size can use `navigator.hardwareConcurrency`) |
| Backpressure location | Pipeline level | Actual bottleneck |
| User configuration | Required | Optional |

### Why This Is Better Than Current Queue Design

| Aspect | Current Design | Proposed Design |
|--------|----------------|-----------------|
| `maxQueueDepth` meaning | Bounds `pending` only | Bounds total items |
| `block` policy | Adds to unbounded `blocked` queue | Truly blocks at call site |
| Memory usage | Unbounded with `block` | Bounded |
| User mental model | Confusing (two queues) | Simple (one bounded buffer) |

### Summary

The queue abstraction IS valuable for:
- Worker pool management (distributing work across N workers)
- Crash recovery (tracking in-flight work)
- Observability (queue depth metrics)
- Load shedding (reject/drop policies)

The queue abstraction should ALSO provide:
- Automatic backpressure via sensible defaults
- True blocking that works as expected

This positions Atelier as a library where things "just work" out of the box, with advanced options for users who need fine-grained control.

---

## 9. Implementation Plan

### Phase 1: Fix DispatchQueue

**Remove the `blocked` queue. Replace with capacity waiters.**

```typescript
class DispatchQueue<T> {
  private readonly pending: QueueEntry<T>[] = []
  private readonly inFlight = new Set<QueueEntry<T>>()
  private readonly capacityWaiters: Array<{
    resolve: () => void
    reject: (error: Error) => void
    signal?: AbortSignal
  }> = []

  async enqueue(payload: T, options?: TaskDispatchOptions): Promise<unknown> {
    // Handle abort before we even try
    if (options?.signal?.aborted) {
      return Promise.reject(createAbortError())
    }

    // For 'block' policy: wait for capacity BEFORE accepting
    if (this.queuePolicy === 'block' && this.pending.length >= this.maxQueueDepth) {
      await this.waitForCapacity(options?.signal)
    }

    // For other policies: reject/drop as before
    if (this.pending.length >= this.maxQueueDepth) {
      // ... existing reject/drop logic
    }

    // Now we have capacity - add to pending
    // ... rest of existing logic
  }

  private waitForCapacity(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal }

      const onAbort = () => {
        const idx = this.capacityWaiters.indexOf(waiter)
        if (idx !== -1) this.capacityWaiters.splice(idx, 1)
        reject(createAbortError())
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      this.capacityWaiters.push(waiter)
    })
  }

  // Called when an item leaves the queue (completes or is removed)
  private notifyCapacityWaiters(): void {
    while (this.capacityWaiters.length > 0 && this.pending.length < this.maxQueueDepth) {
      const waiter = this.capacityWaiters.shift()
      if (waiter) {
        if (waiter.signal) {
          waiter.signal.removeEventListener('abort', waiter.reject)
        }
        waiter.resolve()
      }
    }
  }
}
```

**Key changes:**
- `blocked` queue removed entirely
- `capacityWaiters` holds only callbacks, not payloads (minimal memory)
- `waitForCapacity()` respects abort signals
- Callers truly wait at the call site

### Phase 2: Update Defaults

**In WorkerPool:**
```typescript
constructor(...) {
  // Current: maxQueueDepth defaults to Infinity
  // Proposed: maxQueueDepth defaults to poolSize * 2
  this.maxQueueDepth = maxQueueDepth ?? poolSize * 2

  // Current: queuePolicy defaults to 'block'
  // Keep this - but now it actually works
  this.queuePolicy = queuePolicy ?? 'block'
}
```

**In SingletonWorker:**
```typescript
constructor(...) {
  // Current: maxQueueDepth defaults to Infinity
  // Proposed: maxQueueDepth defaults to 2
  this.maxQueueDepth = maxQueueDepth ?? 2

  this.queuePolicy = queuePolicy ?? 'block'
}
```

### Phase 3: Update State Shape

```typescript
type DispatchQueueState = {
  inFlight: number
  pending: number
  waitingForCapacity: number  // Replaces 'blocked' - callers waiting at call site
  maxInFlight: number
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  paused: boolean
  disposed: boolean
}
```

### Phase 4: Update Tests

- Remove tests that depend on `blocked` queue behavior
- Add tests for true blocking behavior
- Add tests for abort signal handling while waiting for capacity
- Add integration tests showing pipeline backpressure

### Phase 5: Update Demo

- Remove confusing "blocked" display from observability panel
- Show "waiting" count instead (callers waiting for capacity)
- Demo should show backpressure working automatically without `parallelLimit`

---

## 10. Open Questions for Committee

1. **Default queue depths**: Is `poolSize * 2` for pools and `2` for singletons the right default? Should it be configurable globally?

2. **Migration path**: This changes default behavior. Should we:
   - Make it opt-in initially via a flag?
   - Release as a major version bump?
   - Document the change clearly and ship it?

3. **Observability**: Should we expose "waiting for capacity" count in metrics/state? (Recommended: yes)

4. **Naming**: Should we rename `block` policy to something clearer like `backpressure` or `wait`?

5. **parallelLimit utility**: Should we keep exporting `parallelLimit` for users who want explicit control, or is it now redundant?

---

## Appendix: Current DispatchQueue State Shape

```typescript
type DispatchQueueState = {
  inFlight: number      // Currently executing
  pending: number       // Queued, ready to dispatch
  blocked: number       // Waiting for pending capacity (only with 'block' policy)
  maxInFlight: number   // Concurrency limit
  maxQueueDepth: number // Pending queue bound
  queuePolicy: 'block' | 'reject' | 'drop-oldest' | 'drop-latest'
  paused: boolean
  disposed: boolean
}
```

## Appendix: Key Files

- `src/dispatch-queue.ts` - Queue implementation with the two-queue design
- `src/worker-pool.ts` - Parallel worker executor
- `src/singleton-worker.ts` - Single worker executor
- `examples/observability-demo/` - Demo application where issue was discovered
