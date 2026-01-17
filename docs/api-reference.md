# Atelier API Reference

This reference documents the public API surface for Atelier. It is
intentionally concise and reflects the current implementation.

## createTaskRuntime

```ts
const runtime = createTaskRuntime({
  observability: { spans: 'auto' },
})
```

```ts
type RuntimeConfig = {
  observability?: ObservabilityConfig
}
```

Returns:

- `defineTask<T>(config: TaskConfig): Task<T>`
- `abortTaskController: AbortTaskController`
- `getRuntimeSnapshot(): RuntimeSnapshot`
- `subscribeRuntimeSnapshot(listener, options?): () => void`
- `subscribeEvents(listener): () => void`
- `createTrace(name?): TraceContext`
- `runWithTrace(name, fn): Promise<T>`

## TaskConfig

```ts
type TaskConfig = {
  type: 'parallel' | 'singleton'
  worker: () => Worker
  init?: 'lazy' | 'eager'
  poolSize?: number
  keyOf?: (...args: any[]) => string
  timeoutMs?: number
  crashPolicy?: 'restart-fail-in-flight' | 'restart-requeue-in-flight' | 'fail-task'
  crashMaxRetries?: number
  taskName?: string
  taskId?: string
  maxInFlight?: number
  maxQueueDepth?: number
  queuePolicy?: 'block' | 'reject' | 'drop-latest' | 'drop-oldest'
  idleTimeoutMs?: number
}
```

Notes:
- `keyOf` derives the cancellation key per call. Returning an empty string
  is treated as “no key”.
- `timeoutMs` is applied per dispatch and aborts the call.
- `maxInFlight` defaults to `poolSize` (parallel) or `1` (singleton).
- `maxQueueDepth` defaults to `maxInFlight * 2` (parallel) or `2` (singleton).
- `queuePolicy: 'block'` waits at the call site until queue capacity exists.
- `crashPolicy` controls recovery after worker crashes. Default is
  `restart-fail-in-flight`.
- `crashMaxRetries` caps consecutive crashes before escalating to `fail-task`
  (default `3`).
- Restart policies apply a small internal backoff (100ms → 2s) between restarts.

## Task<T>

A task is a typed proxy with worker methods plus lifecycle helpers:

```ts
const task = runtime.defineTask<MyWorkerAPI>({ ... })
```

Methods:

- worker methods (proxied via Comlink)
- `with(options: TaskDispatchOptions): Task<T>`
- `getState(): WorkerState`
- `startWorkers(): void`
- `stopWorkers(): void`
- `dispose(): void`

Note: Tasks intentionally do not expose a `then` property to avoid thenable
behavior when passed to Promise resolution.
Note: `with` is reserved on tasks for dispatch options.

Dispatch options are applied out-of-band via `task.with(options)` and are not
passed to worker handlers.

Example:

```ts
await resize.with({ transfer: [image.data.buffer] }).process(image)
```

## TaskDispatchOptions

```ts
type TaskDispatchOptions = {
  key?: string
  signal?: AbortSignal
  trace?: TraceContext
  transfer?: Transferable[]
  transferResult?: boolean
}
```

Notes:
- Dispatch options are applied via `task.with(options)` and are not passed to worker handlers.
- `trace` attaches explicit trace context to the call and is never passed to worker handlers.
- `transfer`:
  - `undefined` (default): auto-detect using the `transferables` library.
  - `[]`: explicitly disable transfer (clone everything).
  - `[buffer1, buffer2, ...]`: explicit list of transferables.
- Transferred buffers are detached on the sender; clone first if you need to retain data.
- `transferResult` defaults to `true`; set `false` if the worker needs to retain results.

Auto-detected transferable types include `ArrayBuffer`, `TypedArray.buffer`,
`ImageBitmap`, `OffscreenCanvas`, `VideoFrame`, `AudioData`, `MessagePort`, and
stream types (`ReadableStream`, `WritableStream`, `TransformStream`).

Migration note:
- Manual `comlink.transfer(...)` tagging is still supported but usually unnecessary.
  Prefer `task.with({ transfer: [...] })` for explicit control.

## AbortTaskController

```ts
abortTaskController.signalFor(key: string): AbortSignal
abortTaskController.abort(key: string): void
abortTaskController.abortMany(keys: string[]): void
abortTaskController.isAborted(key: string): boolean
abortTaskController.clear(key: string): void
abortTaskController.clearAll(): void
```

## parallelLimit

```ts
for await (const result of parallelLimit(items, limit, fn, options)) {
  // results in completion order
}
```

Options:

```ts
type ParallelLimitOptions<T> = {
  errorPolicy?: 'fail-fast' | 'continue'
  onError?: (error: unknown, item: T) => void
  signal?: AbortSignal
  abortTaskController?: AbortTaskController
  keyOf?: (item: T) => string
}

type ParallelLimitSettledOptions<T> = {
  returnSettled: true
  onError?: (error: unknown, item: T) => void
  signal?: AbortSignal
  abortTaskController?: AbortTaskController
  keyOf?: (item: T) => string
}
```

Behavior when cancellation options are provided:

- skips scheduling items whose key is already aborted
- treats `AbortError` as non-fatal
- drops results for aborted keys at yield-time by default

## createTaskWorker

```ts
const workerApi = createTaskWorker(handlers)
expose(workerApi)
```

`handlers` is an object of worker methods. The harness injects a `TaskContext`
as the final argument for each handler.

### TaskContext

```ts
type TaskContext = {
  signal: AbortSignal
  key?: string
  callId: string
  throwIfAborted: () => void
}
```

### StripTaskContext

```ts
type StripTaskContext<T>
```

Type helper that removes the `TaskContext` parameter from handler method types
so the main thread API does not expose it.

## Observability

### Runtime snapshots

```ts
const snapshot = runtime.getRuntimeSnapshot()
const unsubscribe = runtime.subscribeRuntimeSnapshot(listener, options)
```

```ts
type RuntimeSnapshot = {
  tasks: RuntimeTaskSnapshot[]
}
```

`RuntimeTaskSnapshot` contains queue and worker metrics for each task.
If a worker has crashed, `lastCrash` includes the most recent crash metadata.

### Observability config

```ts
type ObservabilityConfig = {
  spans?: SpansConfig
}

type SpansConfig =
  | 'auto'
  | 'on'
  | 'off'
  | {
      mode?: 'auto' | 'on' | 'off'
      sampleRate?: number
    }
```

Notes:
- `'auto'` enables spans in dev builds and disables them in production builds.
- Dev/prod detection prefers `import.meta.env.DEV`, then falls back to
  `process.env.NODE_ENV !== 'production'` when available.
- `sampleRate` is clamped to `0..1` and applies to trace sampling (or root span sampling
  when no trace is attached). Unsampled spans/traces emit no span/trace measures or events.

### Tracing

```ts
const trace = runtime.createTrace('doc:123')
await resize.with({ trace }).process(image)
trace.end()
```

```ts
await runtime.runWithTrace('doc:123', async trace => {
  await resize.with({ trace }).process(image)
})
```

```ts
type TraceContext = {
  id: string
  name?: string
  sampled: boolean
  end: (options?: TraceEndOptions) => void
}

type TraceEndOptions = {
  status?: 'ok' | 'error' | 'canceled'
  error?: unknown
}
```

`runWithTrace` automatically calls `trace.end()` with `status: 'ok'` or `'error'`
(`'canceled'` for `AbortError`) based on the callback outcome.

### Event stream

```ts
const unsubscribe = runtime.subscribeEvents(event => {
  // MetricEvent | SpanEvent | TraceEvent
})
```

```ts
type RuntimeEvent = MetricEvent | SpanEvent | TraceEvent

type MetricEvent = {
  kind: 'counter' | 'gauge' | 'histogram'
  name: string
  value: number
  ts: number
  attrs?: Record<string, string | number>
}

type SpanEvent = {
  kind: 'span'
  name: 'atelier:span'
  ts: number
  spanId: string
  traceId?: string
  traceName?: string
  callId: string
  taskId: string
  taskName?: string
  taskType: TaskType
  method: string
  workerIndex?: number
  queueWaitMs?: number
  queueWaitLastMs?: number
  attemptCount: number
  durationMs?: number
  status: 'ok' | 'error' | 'canceled'
  errorKind?: 'abort' | 'queue' | 'crash' | 'exception'
  error?: string
}

type TraceEvent = {
  kind: 'trace'
  name: 'atelier:trace'
  ts: number
  traceId: string
  traceName?: string
  durationMs?: number
  status: 'ok' | 'error' | 'canceled'
  errorKind?: 'abort' | 'queue' | 'crash' | 'exception'
  error?: string
}
```

### Performance spans

When spans are enabled and sampled, each task call emits
`performance.measure('atelier:span', ...)` and `trace.end()` emits
`performance.measure('atelier:trace', ...)`. Use a
`PerformanceObserver` if you want access to these entries.

**Recommendation:** use `subscribeEvents()` as the canonical telemetry stream
(metrics + span/trace events with full metadata). Performance measures are
best-effort and can be dropped or omit `detail` depending on browser support,
so they are best suited for profiling and devtools integrations.

## Errors

### WorkerCrashedError

Thrown when a worker crashes and in-flight work is rejected. Exposes:

- `taskId`
- `workerIndex?`
- `cause?`
