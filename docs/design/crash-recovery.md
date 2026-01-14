# Crash Recovery

Workers can crash (error/messageerror). Each task declares a `crashPolicy` that
controls recovery behavior and in-flight handling.

## Policies

- `restart-fail-in-flight` (default): reject in-flight calls, restart worker(s).
- `restart-requeue-in-flight`: requeue in-flight calls and retry on fresh worker.
- `fail-task`: halt the task and reject all queued/in-flight work.

## Backoff and escalation

Restarts apply a small internal backoff (100ms -> 2s) to avoid tight crash loops.
`crashMaxRetries` caps consecutive crashes before escalating to `fail-task`.

## Observability

- Task snapshot `lastCrash` captures timestamp, error, and worker index.
- Metric counter `worker.crash.total` is emitted on each crash.
- `WorkerCrashedError` is surfaced to callers when in-flight work is rejected.
