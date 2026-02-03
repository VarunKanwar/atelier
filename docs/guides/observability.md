# Observability

Atelier exposes three surfaces: runtime snapshots, an event stream, and optional
spans/traces. All emission is opt-in; nothing is emitted unless listeners are
registered.

## Runtime snapshots

Use snapshots for a consistent view of current state.

```ts
const runtime = createTaskRuntime()

const snapshot = runtime.getRuntimeSnapshot()
// snapshot.tasks[*] includes queue depths, worker status, and lastCrash

const unsubscribe = runtime.subscribeRuntimeSnapshot(next => {
  console.log(next.tasks)
})
```

## Event stream

The event stream is the canonical feed for metrics, spans, and traces.

```ts
const unsubscribe = runtime.subscribeEvents(event => {
  if (event.kind === 'counter') {
    console.log(event.name, event.value)
  }
})
```

Events are synchronous and best-effort. Keep handlers fast.

## Spans and traces

Spans are opt-in via runtime config. Traces are explicit and attached to calls.

```ts
const runtime = createTaskRuntime({
  observability: { spans: { mode: 'on', sampleRate: 1 } },
})

const trace = runtime.createTrace('image-pipeline')
await resize.with({ trace }).process(image)
trace.end()
```

If you prefer a scoped helper:

```ts
await runtime.runWithTrace('image-pipeline', async trace => {
  await resize.with({ trace }).process(image)
})
```

Spans are emitted for each task call with queue wait time, attempt count, and
final status (`ok`, `error`, `canceled`).
