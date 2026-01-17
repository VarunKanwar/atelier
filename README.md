# Atelier

[![npm version](https://img.shields.io/npm/v/@varunkanwar/atelier.svg)](https://www.npmjs.com/package/@varunkanwar/atelier)
[![npm downloads](https://img.shields.io/npm/dm/@varunkanwar/atelier.svg)](https://www.npmjs.com/package/@varunkanwar/atelier)
[![license](https://img.shields.io/npm/l/@varunkanwar/atelier.svg)](https://github.com/VarunKanwar/atelier/blob/main/LICENSE)
[![CI](https://github.com/VarunKanwar/atelier/actions/workflows/test.yml/badge.svg)](https://github.com/VarunKanwar/atelier/actions/workflows/test.yml)

Atelier is a small task runtime for browser workloads that need parallelism,
backpressure, and cancellation without a pipeline DSL.

## What it provides

- Task-based API with `async/await` calls
- Parallel pools and singleton workers with per-task backpressure
- Keyed cancellation that propagates across task queues and pipelines
- Cooperative worker-side cancellation via a small harness
- Worker crash detection with an explicit recovery policy
- Runtime-scoped observability snapshots and event stream

## Queue states (what they mean for your app)

- **In flight**: work is executing on a worker (active CPU time).
- **Pending**: accepted but not started. The runtime holds the payload, so memory
  and latency grow with the backlog.
- **Waiting**: the caller is paused before the runtime accepts the work. This is
  a signal to reduce upstream concurrency or defer large allocations until the
  system has capacity.
- Queues bound accepted work, not payload allocation. If you build large payloads
  before calling a task, memory can still blow up; keep allocation inside a
  `parallelLimit` block or inside the worker (e.g., pass a `File`/`Blob` and
  decode there) to keep memory stable.

## Core concepts

- **Runtime**: created via `createTaskRuntime()`. Owns the task registry and
  cancellation domain for a specific scope.
- **Task**: a typed proxy around worker handlers, created via `runtime.defineTask`.
- **Dispatch options**: per-call metadata applied via `task.with(options)` (transfer,
  cancellation, timeouts, tracing).
- **Keyed cancellation**: `keyOf` derives a string key per call; `abortTaskController`
  aborts all work for that key.
- **Worker harness**: `createTaskWorker` injects a `TaskContext` with an AbortSignal
  so handlers can cooperate with cancellation.

## Installation

```bash
bun add @varunkanwar/atelier
# or
npm install @varunkanwar/atelier
```

**Note:** Atelier is designed for browser workloads and works best with Bun or bundlers (Vite, Webpack, esbuild, etc.). For direct Node.js usage without a bundler, you may need additional configuration for ESM imports.

## Quick start

Main thread:

```ts
import { createTaskRuntime } from '@varunkanwar/atelier'

type ResizeAPI = {
  process: (image: ImageData) => Promise<ImageData>
}

const runtime = createTaskRuntime()

const resize = runtime.defineTask<ResizeAPI>({
  type: 'parallel',
  worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
  keyOf: (image) => image.docId,
  timeoutMs: 10_000,
})

const result = await resize.process(image)
```

Worker:

```ts
import { expose } from 'comlink'
import { createTaskWorker, type TaskContext, type StripTaskContext } from '@varunkanwar/atelier'

const handlers = {
  async process(image: ImageData, ctx: TaskContext) {
    ctx.throwIfAborted()
    return resized
  },
}

export type ResizeAPI = StripTaskContext<typeof handlers>
expose(createTaskWorker(handlers))
```

## Cancellation and pipelines

- Provide `keyOf` on every task that should be cancelable.
- Call `abortTaskController.abort(key)` to cancel queued and in-flight work.
- Use `parallelLimit(..., { abortTaskController, keyOf })` to avoid scheduling
  canceled items and to drop results for aborted keys by default.

## Zero-copy transfers

Atelier automatically transfers large data (ArrayBuffer, ImageData, etc.) without copying for maximum performance:

```ts
// Automatic zero-copy transfer (default)
const result = await resize.process(imageData)
// imageData.data.buffer transferred to worker (~0.001ms vs ~50ms for cloning 10MB)

// Explicitly disable transfer (clone instead)
const result = await resize.with({ transfer: [] }).process(imageData)
// Original imageData remains usable

// Selective transfer (mixed data)
const lookupTable = new Float32Array(1000)
for (const image of images) {
  await colorCorrect.with({ transfer: [image.data.buffer] }).process(image, lookupTable)
  // lookupTable remains usable for next iteration
}

// Worker keeps result (rare)
await encoder.with({ transferResult: false }).addFrame(frame)
// Worker's internal cache still has the frame
```

Transfers move ownership: the sender’s buffers become detached. Clone first if
you need to keep the original, or temporarily disable transfer with
`task.with({ transfer: [] })` to debug “buffer is detached” issues.

**Performance impact:** Zero-copy transfers are ~5,000x-500,000x faster than cloning for large data (1MB-100MB).

**Supported types:** ArrayBuffer, TypedArray.buffer, ImageBitmap, OffscreenCanvas, VideoFrame, AudioData, MessagePort, ReadableStream, WritableStream, TransformStream.

## Observability

Runtime snapshots are runtime-scoped:

```ts
const runtime = createTaskRuntime()
const snapshot = runtime.getRuntimeSnapshot()
```

For metrics, spans, and trace timing, use the event stream plus optional
Performance API measures:

```ts
const runtime = createTaskRuntime({
  observability: { spans: { mode: 'auto', sampleRate: 1 } },
})

const unsubscribe = runtime.subscribeEvents(event => {
  // MetricEvent | SpanEvent | TraceEvent
})

await runtime.runWithTrace('doc:123', async trace => {
  await resize.with({ trace }).process(image)
})
```

Recommended usage:
- Use `subscribeEvents()` as the canonical telemetry stream (counters, gauges,
  histograms, and span/trace events with full metadata).
- Use `PerformanceObserver` only for profiling/devtools integrations. Measures
  are best-effort and may drop entries or omit `detail` in some browsers.

## API summary

- `createTaskRuntime()`
  - `defineTask<T>(config: TaskConfig): Task<T>` (per-call options via `task.with(...)`)
  - `abortTaskController: AbortTaskController`
  - `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()`
  - `subscribeEvents(listener)`
  - `createTrace(name?)` / `runWithTrace(name, fn)`
- `createTaskWorker(handlers)`
  - `TaskContext` (signal, key, callId, `throwIfAborted()`)
  - `StripTaskContext<T>` removes the worker-only context from the public type
- `parallelLimit(items, limit, fn, options)`
  - supports cancellation options (`abortTaskController`, `keyOf`, `signal`)

## Docs

- [Design](./docs/design/README.md) - Architecture and design decisions
- [Observability Design](./docs/design/observability.md) - Telemetry model and decisions
- [API Reference](./docs/api-reference.md) - Complete API documentation
- [Testing](./docs/testing.md) - Testing patterns

## Development

```bash
# Clone and install
git clone https://github.com/VarunKanwar/atelier.git
cd atelier
bun install

# Run tests
bun run test

# Lint and format
bun run check:fix

# Build
bun run build
```

## Examples

See the `examples/` directory for runnable demos:

- `examples/observability-demo/` - Guided tour of workers, queues, and backpressure

To run the guided tour:

```bash
bun run examples
```

Open `http://localhost:5173` in your browser.
