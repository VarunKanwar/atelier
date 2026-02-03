# Guides

These guides focus on using Atelier in real apps. They are intentionally
practical and assume you already know basic Web Worker concepts.

If you need a refresher on Web Workers:
- [MDN: Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- [MDN: Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

## Index
- [Getting started](getting-started.md) - Create a runtime, define a task, and call it.
- [Worker setup](worker-setup.md) - Implement worker handlers and cancellation wiring.
- [Backpressure and queue states](backpressure-and-queues.md) - Tune queue limits and policies.
- [Cancellation and timeouts](cancellation-and-timeouts.md) - Cancel queued and in-flight work safely.
- [Crash recovery](crash-recovery.md) - Pick a crash policy and understand retries.
- [Transferables](transferables.md) - Control zero-copy transfer behavior.
- [Observability](observability.md) - Use snapshots, events, and traces.
