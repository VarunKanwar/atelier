# Pipeline Scheduling (`parallelLimit`)

`parallelLimit` provides pipeline-level backpressure without a DSL. It limits
in-flight async operations and yields results in completion order.

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
