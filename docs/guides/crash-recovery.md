# Crash recovery

Workers can crash (error or messageerror). Each task declares a `crashPolicy`
that determines how Atelier responds and what happens to in-flight work.

## Policies

- `restart-fail-in-flight` (default): restart workers, reject in-flight calls.
- `restart-requeue-in-flight`: restart workers, requeue in-flight calls.
- `fail-task`: stop the task and reject all pending and in-flight work.

If in-flight work is rejected due to a crash, callers receive a
`WorkerCrashedError`.

## Example

```ts
const encode = runtime.defineTask<EncoderAPI>({
  type: 'parallel',
  worker: () => new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' }),
  crashPolicy: 'restart-requeue-in-flight',
  crashMaxRetries: 3,
})
```

## Retries and escalation

`crashMaxRetries` caps consecutive crashes before the task escalates to
`fail-task`. Restarts use a small backoff to avoid tight crash loops.

## Observability hooks

Crash metadata is captured in `getState()` as `lastCrash`, and crash counters
are emitted through the runtime event stream when listeners are active.
