# Atelier API Reference

This reference documents the public API surface for Atelier. It is
intentionally concise and reflects the current implementation.

## createTaskRuntime

```ts
const runtime = createTaskRuntime()
```

Returns:

- `defineTask<T>(config: TaskConfig): Task<T>`
- `abortTaskController: AbortTaskController`
- `getRuntimeSnapshot(): RuntimeSnapshot`
- `subscribeRuntimeSnapshot(listener, options?): () => void`

## TaskConfig

```ts
type TaskConfig = {
  type: 'parallel' | 'singleton'
  worker: () => Worker
  init?: 'lazy' | 'eager'
  poolSize?: number
  keyOf?: (...args: any[]) => string
  timeoutMs?: number
  taskName?: string
  taskId?: string
  telemetry?: (event: TaskEvent) => void
  maxInFlight?: number
  maxQueueDepth?: number
  queuePolicy?: 'block' | 'reject' | 'drop-latest' | 'drop-oldest'
  idleTimeoutMs?: number
  crashPolicy?: 'restart-fail-in-flight' | 'restart-requeue-in-flight' | 'fail-task'
  crashMaxRetries?: number
}
```

Notes:
- `keyOf` derives the cancellation key per call. Returning an empty string
  is treated as “no key”.
- `timeoutMs` is applied per dispatch and aborts the call.
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
  transfer?: Transferable[]
  transferResult?: boolean
}
```

Notes:
- Dispatch options are applied via `task.with(options)` and are not passed to worker handlers.
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

### Telemetry store

```ts
const telemetry = createTelemetryStore()
const task = runtime.defineTask({ telemetry: telemetry.emit, ... })
```

`createTelemetryStore` is optional and provides latency/queue-wait percentiles.

## Errors

### WorkerCrashedError

Thrown when a worker crashes and in-flight work is rejected. Exposes:

- `taskId`
- `workerIndex?`
- `cause?`
