# Worker setup

Atelier workers use `createTaskWorker` to standardize dispatch and
cancellation. Your handlers stay focused on the work, while the harness wires
`__dispatch` and `__cancel` behind the scenes.

## Define handlers

Handlers are plain async functions. They receive a `TaskContext` as the final
argument.

```ts
import { createTaskWorker, type TaskContext, type StripTaskContext } from '@varunkanwar/atelier'
import { expose } from 'comlink'

const handlers = {
  async parse(buffer: ArrayBuffer, ctx: TaskContext) {
    ctx.throwIfAborted()
    const view = new DataView(buffer)
    return view.getUint32(0, true)
  },
  async transform(data: Float32Array, ctx: TaskContext) {
    for (let i = 0; i < data.length; i += 1) {
      if (ctx.signal.aborted) {
        ctx.throwIfAborted()
      }
      data[i] = Math.min(1, Math.max(0, data[i]))
    }
    return data
  },
}

export type WorkerAPI = StripTaskContext<typeof handlers>
expose(createTaskWorker(handlers))
```

## TaskContext essentials

`TaskContext` provides:

- `signal`: an `AbortSignal` that is aborted on cancellation or timeout.
- `key`: the cancellation key for this call (if any).
- `callId`: the unique call id for this dispatch.
- `throwIfAborted()`: throws an `AbortError` if canceled.

Cancellation is cooperative. Long-running handlers should check `ctx.signal` or
call `ctx.throwIfAborted()` in loops.

## Why the harness matters

Executors always call `__dispatch(callId, method, args, key)` and use
`__cancel(callId)` for in-flight cancellation. If you bypass
`createTaskWorker`, you lose that standardized wiring.
