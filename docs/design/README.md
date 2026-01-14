# Atelier Design Notes

This directory captures the architectural decisions and rationale behind Atelier.
It replaces the old monolithic design spec with focused, explainer-style docs.
If you are making changes to core behavior, start here and update the relevant
document to preserve intent.

## Index

- runtime.md: runtime scope, task registry, and dispatch flow
- executors.md: WorkerPool vs SingletonWorker design and lifecycle
- dispatch-queue.md: queue semantics, backpressure, and state transitions
- worker-harness.md: worker-side `createTaskWorker` and cancellation wiring
- transferables.md: zero-copy transfer strategy and tradeoffs
- crash-recovery.md: crash policies, backoff, and in-flight handling
- cancellation.md: keyed cancellation across queue, worker, and pipeline
- pipeline.md: `parallelLimit` behavior and cancellation integration
- observability.md: state API, event stream, spans, and trace model

## Design goals

- Browser-only runtime with minimal dependencies.
- Predictable backpressure and queue semantics.
- Explicit cancellation and trace context (no implicit propagation).
- Small, focused API surface with runtime-scoped behavior.
- Observability that is reliable and low overhead by default.

## Tradeoffs

- Cooperative cancellation: worker handlers must check the signal.
- No global scheduler: tasks are independent; no cross-task fairness.

## TODOs
- Currently no durable queues: all state is in-memory and reset on refresh.
- Exportable trace context: no W3C Trace Context or OpenTelemetry integration yet.
