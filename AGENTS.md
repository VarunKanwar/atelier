# Atelier Agents Guide

This file captures repo-specific instructions and context for coding agents.
Keep it concise, practical, and aligned with how the library is structured.

## Project Overview

Atelier is a browser-only task runtime for Web Worker orchestration. It provides:
- Task runtime (`createTaskRuntime`) with per-task executors.
- Executors: `WorkerPool` (parallel) and `SingletonWorker` (serialized).
- Backpressure via `DispatchQueue`.
- Keyed cancellation via `AbortTaskController`.
- Crash recovery policies.
- Observability docs (see `docs/observability-redesign*.md`).

## Key Files

- Runtime: `packages/atelier/src/runtime.ts`
- Task definition/proxy: `packages/atelier/src/define-task.ts`
- Executors: `packages/atelier/src/worker-pool.ts`, `packages/atelier/src/singleton-worker.ts`
- Queue: `packages/atelier/src/dispatch-queue.ts`
- Worker harness: `packages/atelier/src/task-worker.ts`
- Types: `packages/atelier/src/types.ts`
- Tests: `packages/atelier/tests/`
- Docs: `docs/`

## Code Style & Tooling

- TypeScript, ESM (`"type": "module"` in `package.json`).
- Formatting/lint: Biome (`bun run check` / `bun run check:fix`).
- Tests: Vitest (`bun run test`).
- Build: `bun run build` (tsc build config in `packages/atelier/tsconfig.build.json`).

Prefer small, well-scoped changes and keep types precise.

## Testing Expectations

- For behavior changes in executors/queue/cancellation, add or update tests.
- Integration tests live under `packages/atelier/tests/integration`.
- Unit tests live under `packages/atelier/tests/unit`.
- Worker crash/cancellation tests use `packages/atelier/tests/helpers/fake-worker.ts`.

## Architectural Notes

- **Dispatch flow**: task calls are wrapped by `defineTask`, queued by
  `DispatchQueue`, then executed via `__dispatch` on the worker harness.
- **Transferables**: automatic zero-copy transfer is implemented in
  `WorkerPool`/`SingletonWorker` using the `transferables` library and Comlink.
- **Crash recovery**: handled in executors with backoff and policy-based
  behavior; ensure changes keep `WorkerCrashedError` semantics consistent.
- **Cancellation**: keyed cancellation (`AbortTaskController`) is runtime-scoped.
  Ensure cancellation phases (waiting/queued/in-flight) remain consistent.

## Observability Work

There are two spec paths:
- `docs/observability-redesign.md` (Performance API + state + events)
- `docs/observability-redesign-with-otel.md` (OTel-first)

Do not mix the two. If implementing one path, follow its spec and update tests.
Avoid in-library aggregation (p50/p95) unless explicitly requested.

## Common Pitfalls

- Worker APIs rely on `__dispatch` and `__cancel` from the harness.
- `task.with(...)` is reserved for dispatch options; do not add conflicting
  properties to task proxies.
- Queue policies (`block`, `reject`, `drop-latest`, `drop-oldest`) have subtle
  semantics; update tests if changing behavior.
- Avoid relying on Node-only APIs; this is browser-first.
