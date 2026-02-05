# Transferables

Atelier defaults to zero-copy transfer for large payloads to avoid structured
clone overhead. Transfers move ownership, so treat transferred objects as
consumed.

## Default behavior

By default, Atelier auto-detects transferable objects (ArrayBuffer, ImageData,
ImageBitmap, streams) and transfers them when dispatching to a worker.

## Control transfer per call

```ts
// Disable transfers (force cloning)
await resize.with({ transfer: [] }).process(imageData)

// Provide an explicit list
await resize.with({ transfer: [imageData.data.buffer] }).process(imageData)

// Keep results in the worker (clone on return)
await encode.with({ transferResult: false }).addFrame(frame)
```

## When to opt out

- You need to keep using the original buffer on the sender.
- The payload is tiny and cloning cost is negligible.

## Common gotchas

- Transferred buffers are detached and become unusable on the sender.
- `SharedArrayBuffer` is already shared and is not transferred.
