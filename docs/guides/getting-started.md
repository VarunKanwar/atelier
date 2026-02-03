# Getting started

Atelier is a browser-only task runtime for Web Worker workloads. You define a
runtime, register tasks, and call them like normal async methods. Each call is
backpressured and cancellable.

## Install

```bash
bun add @varunkanwar/atelier
# or
npm install @varunkanwar/atelier
```

## Define a task (main thread)

```ts
import { createTaskRuntime } from '@varunkanwar/atelier'

type ResizeAPI = {
  process: (image: ImageData) => Promise<ImageData>
}

const runtime = createTaskRuntime()

const resize = runtime.defineTask<ResizeAPI>({
  type: 'parallel',
  worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 4,
  maxInFlight: 4,
  maxQueueDepth: 8,
})

const result = await resize.process(image)
```

## Implement the worker

```ts
import { expose } from 'comlink'
import { createTaskWorker, type TaskContext, type StripTaskContext } from '@varunkanwar/atelier'

const handlers = {
  async process(image: ImageData, ctx: TaskContext) {
    ctx.throwIfAborted()
    return image
  },
}

export type ResizeAPI = StripTaskContext<typeof handlers>
expose(createTaskWorker(handlers))
```

## Pick the right executor

- Use `type: 'parallel'` for CPU-bound work that can run on multiple workers.
- Use `type: 'singleton'` for GPU-bound work or when you must serialize access.

Defaults:
- `poolSize` defaults to `navigator.hardwareConcurrency` (or 4).
- `maxInFlight` defaults to `poolSize` for parallel tasks and `1` for singleton.
- `maxQueueDepth` defaults to `maxInFlight * 2` (parallel) or `2` (singleton).

## Next steps

- If you need cancellation and timeouts, start with
  [Cancellation and timeouts](cancellation-and-timeouts.md).
- To reduce cloning cost, see [Transferables](transferables.md).
- For queue tuning, see [Backpressure and queue states](backpressure-and-queues.md).
