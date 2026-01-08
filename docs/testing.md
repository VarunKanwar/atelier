# Atelier Testing

This repo uses Vitest for Atelier tests. Tests live under `tests/atelier/`.

## Worker harness

Crash-recovery tests use a minimal `FakeWorker` shim (`tests/atelier/helpers/fake-worker.ts`).
It emulates the parts of the Worker interface that the runtime relies on:

- `addEventListener` / `removeEventListener`
- `terminate`
- explicit `error` / `messageerror` emission

`comlink.wrap` is mocked in these tests to return the worker instance directly,
so the fake worker can expose `__dispatch` without a real Worker thread.

This keeps tests deterministic while still exercising the recovery logic paths
that depend on worker events.
