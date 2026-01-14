# Transferables

Atelier defaults to zero-copy transfer for large payloads to avoid structured
clone overhead. Transfers are a move of ownership: the sender's buffers become
"detached", so treat transferred objects as consumed.

## Control surface

- Auto-detect transferables from arguments and results using the
  `transferables` library.
- `task.with({ transfer: [...] })` supplies an explicit list.
- `task.with({ transfer: [] })` disables transfer (clone everything).
- `task.with({ transferResult: false })` keeps results in the worker.

Transfer tagging is done via Comlink's `transfer(...)` helper, which marks
objects for zero-copy transfer when `postMessage` is used under the hood.

## Rationale

- `transferResult: true` matches typical stateless processing.
- Stateful workers can opt out when they need to retain results.

## Notes and tradeoffs

- Circular references are handled by `transferables` via `WeakSet`.
- Traversal depth is bounded (default depth limit of 10) to cap cost.
- Shared buffers across args are deduplicated.
- `SharedArrayBuffer` is not transferable (already shared).
- Small objects incur minimal overhead; large objects benefit the most.

## References

- MDN: Transferable Objects
- transferables library
- Comlink transfer documentation
