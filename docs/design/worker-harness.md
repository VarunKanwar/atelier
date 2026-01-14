# Worker Harness

`createTaskWorker(handlers)` produces a small harness that standardizes
cancellation and dispatch behavior inside a worker.

## What it does

- Creates a per-call `AbortController`.
- Injects a `TaskContext` as the final handler argument.
- Exposes `__dispatch(callId, method, args, key)`.
- Exposes `__cancel(callId)` to abort in-flight work.

## TaskContext

`TaskContext` includes:

- `signal: AbortSignal`
- `key?: string`
- `callId: string`
- `throwIfAborted(): void`

Handlers are expected to cooperate with cancellation by checking
`ctx.signal.aborted` or calling `ctx.throwIfAborted()`.

## Dispatch contract

Executors call the harness method `__dispatch` so all work passes through the
same cancellation wiring and callId tracking. This avoids per-handler boilerplate
and keeps cancellation behavior consistent.
