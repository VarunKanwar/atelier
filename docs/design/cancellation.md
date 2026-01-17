# Keyed Cancellation

Cancellation uses a runtime-scoped `AbortTaskController`:

- each key maps to an `AbortSignal`
- `abort(key)` cancels all queued and in-flight work for that key
- `clear(key)` removes key state to avoid unbounded maps

## Where cancellation is applied

1. **Queue-level**: waiting/pending entries are removed when the signal aborts.
2. **Worker-level**: in-flight work is canceled via `__cancel(callId)`.
3. **Pipeline-level**: `parallelLimit` skips scheduling canceled items and drops
   results for aborted keys by default.

## Dispatch signal composition

`defineTask` composes a dispatch signal from:

- the keyed cancellation signal (if `keyOf` is provided)
- an optional timeout signal (`timeoutMs`)

The composed signal is attached to the dispatch and used by the queue and
worker harness.
