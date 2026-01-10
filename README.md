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
- Runtime-scoped observability snapshots

## Core concepts

- **Runtime**: created via `createTaskRuntime()`. Owns the task registry and
  cancellation domain for a specific scope.
- **Task**: a typed proxy around worker handlers, created via `runtime.defineTask`.
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

## Observability

Runtime snapshots are runtime-scoped:

```ts
const runtime = createTaskRuntime()
const snapshot = runtime.getRuntimeSnapshot()
```

For latency and queue wait percentiles, attach a telemetry store:

```ts
import { createTelemetryStore } from '@varunkanwar/atelier'

const telemetry = createTelemetryStore()
const task = runtime.defineTask({
  type: 'singleton',
  worker: () => new Worker('./worker.ts', { type: 'module' }),
  telemetry: telemetry.emit,
})
```

## API summary

- `createTaskRuntime()`
  - `defineTask<T>(config: TaskConfig): Task<T>`
  - `abortTaskController: AbortTaskController`
  - `getRuntimeSnapshot()` / `subscribeRuntimeSnapshot()`
- `createTaskWorker(handlers)`
  - `TaskContext` (signal, key, callId, `throwIfAborted()`)
  - `StripTaskContext<T>` removes the worker-only context from the public type
- `parallelLimit(items, limit, fn, options)`
  - supports cancellation options (`abortTaskController`, `keyOf`, `signal`)

## Docs

- [Design](./docs/design.md) - Architecture and design decisions
- [API Reference](./docs/api-reference.md) - Complete API documentation
- [Testing](./docs/testing.md) - Testing patterns

## Development

```bash
# Clone and install
git clone https://github.com/VarunKanwar/atelier.git
cd atelier
bun install

# Run tests
bun test

# Lint and format
bun run check:fix

# Build
bun run build
```

## Examples

See the `examples/` directory for runnable demos:

- `examples/observability-demo/` - Live view of worker pools, queues, and metrics

To run the observability demo:

```bash
bun run examples
```

Open `http://localhost:5173` in your browser.
