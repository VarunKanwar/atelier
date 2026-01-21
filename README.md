# Atelier

[![npm version](https://img.shields.io/npm/v/@varunkanwar/atelier.svg)](https://www.npmjs.com/package/@varunkanwar/atelier)
[![npm downloads](https://img.shields.io/npm/dm/@varunkanwar/atelier.svg)](https://www.npmjs.com/package/@varunkanwar/atelier)
[![license](https://img.shields.io/npm/l/@varunkanwar/atelier.svg)](https://github.com/VarunKanwar/atelier/blob/main/LICENSE)

Atelier is a browser-only task runtime for Web Worker workloads that need
predictable concurrency, backpressure, and cancellation without adopting a
pipeline DSL. It is intentionally small: a runtime, task proxies, and two
executors backed by a shared queue.

Use it when you have CPU-heavy or bursty work in the browser and you need to
control how much work is in flight and what happens under load. It does not try
to schedule across tasks or define a pipeline language; those decisions stay
with your app.

## Installation

```bash
bun add @varunkanwar/atelier
# or
npm install @varunkanwar/atelier
```

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
  keyOf: image => image.docId,
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

## How it works

Each task call flows through a `DispatchQueue` that enforces `maxInFlight` and
`maxQueueDepth`. A call moves through three phases: waiting (call-site blocked
before admission), pending (accepted but not dispatched), and in-flight (running
on a worker). When the queue is full, the policy determines whether callers
wait, are rejected, or are dropped.

For pipeline-level flow control, `parallelLimit` caps concurrency across a set
of items without introducing a DSL. It pairs well with queue backpressure to
avoid large intermediate allocations.

## Cancellation and timeouts

If you provide a `keyOf` function, `AbortTaskController` can cancel all queued
and in-flight work for a given key. `timeoutMs` creates an AbortSignal per call
and is treated like cancellation. Cancellation can happen while waiting,
queued, or in-flight; the worker harness exposes `__cancel` so handlers can
cooperate.

```ts
const runtime = createTaskRuntime()
const resize = runtime.defineTask<ResizeAPI>({ /* ... */, keyOf: image => image.docId })

const promise = resize.process(image) // image.docId === 'doc-123'
runtime.abortTaskController.abort('doc-123')
await promise
```

## Zero-copy transfers

Atelier automatically transfers common large data types (ArrayBuffer, ImageData,
ImageBitmap, streams, etc.) to avoid structured cloning. You can override that
per call:

```ts
// Disable transfer for debugging or to keep ownership
await resize.with({ transfer: [] }).process(imageData)

// Selective transfer
await colorCorrect.with({ transfer: [image.data.buffer] }).process(image, lut)

// Keep the result in the worker
await encoder.with({ transferResult: false }).addFrame(frame)
```

Transfers move ownership: the sender’s buffers become detached. Clone first if
you need to keep the original.

## Observability

The runtime exposes a state snapshot API plus an event stream for metrics, spans
and traces. Spans are opt-in and sampled; events are emitted only when
listeners are registered.

```ts
const runtime = createTaskRuntime({
  observability: { spans: { mode: 'auto', sampleRate: 1 } },
})

const unsubscribe = runtime.subscribeEvents(event => {
  // MetricEvent | SpanEvent | TraceEvent
})
```

## Docs

- Design notes: `docs/design/README.md`
- Observability model: `docs/design/observability.md`
- API reference (generated via TypeDoc and published at `/docs/` on the site)
- Testing: `docs/testing.md`
- Public landing page: `apps/site/`

## Site deployment (GitHub Pages)

The site is a SPA. For GitHub Pages, build with a base path that matches the
repo name and deploy the `apps/site/dist` output.

```bash
# Example for https://<user>.github.io/atelier/
PUBLIC_BASE_PATH=/atelier/ bun run --cwd apps/site build
```

If you deploy to a custom domain or a user/org root page, use `/` as the base
path.

## Development

```bash
bun install
bun run test
bun run check:fix
```
