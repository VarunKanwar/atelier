# Atelier Testing

This repo uses Vitest for the Atelier tests, which live under the library
package `tests/` directory. Crash-recovery tests use a minimal `FakeWorker`
shim to emulate the Worker surface that the runtime depends on
(`addEventListener`, `removeEventListener`, `terminate`, and explicit `error` /
`messageerror` emission). In those tests, `comlink.wrap` is mocked to return the
worker instance directly so the fake worker can expose `__dispatch` without a
real Worker thread. This keeps tests deterministic while still exercising the
recovery logic paths tied to worker events.
