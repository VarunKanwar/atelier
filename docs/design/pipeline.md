# Pipeline Scheduling (`parallelLimit`)

`parallelLimit` provides pipeline-level flow control without a DSL. It limits
in-flight async operations and yields results in completion order. Use it to
bound concurrency across multi-step workflows where per-task queues alone are
insufficient to prevent intermediate result buildup.

## When to use it

- You have a multi-stage pipeline (decode -> preprocess -> infer).
- You want to cap how many large payloads are "in progress" at once.
- You need cancellation to propagate without scheduling more work.

Per-task queues bound accepted work per task, but they do not provide pipeline
backpressure across tasks. `parallelLimit` makes that flow control explicit at
the call site.

## Reserve-then-build pattern

To avoid memory spikes, allocate large payloads inside the limited section:

```ts
for await (const result of parallelLimit(files, 8, async file => {
  const image = await decode(file) // heavy allocation inside the limit
  const resized = await resize.process(image)
  return analyze.process(resized)
})) {
  results.push(result)
}
```

This ensures only `limit` large payloads exist concurrently, even if the input
batch is much larger.

## Error policy

- `fail-fast` (default): throw on first error.
- `continue`: skip errors and continue yielding results.
- `returnSettled: true`: yield `{ status, value|error }` for each item.

## Cancellation integration

When cancellation options are provided (`signal`, `abortTaskController`, `keyOf`):

- skips scheduling items whose key is already aborted
- treats `AbortError` as non-fatal
- drops results for aborted keys by default

This prevents downstream code from acting on canceled results.
