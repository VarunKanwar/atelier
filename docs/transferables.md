# Transferable Objects Design

## Overview

This document specifies automatic zero-copy transfers for Atelier, enabling high-performance data transfer across the worker boundary for heavy browser workloads (image processing, video encoding, audio processing, etc.).

## Problem

Comlink uses `postMessage` under the hood to send data between the main thread and workers. By default, `postMessage` **clones** data when sending to workers:

```ts
const imageData = ctx.getImageData(0, 0, 1920, 1080); // 10MB
worker.postMessage({ image: imageData });
// Doubles memory usage (10MB → 20MB) and increases latency
```

For large data, this kills performance. Web Workers support **transferring** instead:

```ts
worker.postMessage({ image: imageData }, [imageData.data.buffer]);
// Zero-copy transfer (~0.001ms)
// No extra memory
// ⚠️ imageData.data.buffer is now "neutered" (empty)
```

But manually managing transfer lists is tedious and error-prone. Users must track which objects are transferable and ensure they don't use neutered objects afterward.

## Solution

**Automatic detection with explicit control**: Atelier automatically detects transferable objects using the `transferables` library, with an explicit escape hatch for full control.

## API Specification

### Dispatch Options Placement

Dispatch options are provided out-of-band via `task.with(options)`, not as part of
worker arguments. This keeps handler signatures clean and avoids ambiguous
argument-order heuristics while preserving per-call flexibility.

- **Task args**: data your worker handlers receive.
- **Dispatch options**: envelope metadata used by the runtime (transfer policy,
  cancellation, timeouts, tracing, etc.).
- **Task config**: static, set once in `defineTask(...)`.

### Task Dispatch Options

```ts
type TaskDispatchOptions = {
  /**
   * Transferable objects to transfer (zero-copy) instead of cloning.
   *
   * - undefined (default): Auto-detect using transferables library
   * - []: Explicitly disable transfer (clone everything)
   * - [buffer1, buffer2, ...]: Explicit list of transferables
   *
   * When transferring, the original object becomes "neutered" (unusable).
   * If you need to keep the original, clone it first:
   *   const clone = structuredClone(data);
   *   await task.with({ transfer: [clone.buffer] }).method(clone);
   */
  transfer?: Transferable[]

  /**
   * Whether to transfer the result back from worker to main thread.
   *
   * - true (default): Transfer result (zero-copy, worker loses result)
   * - false: Clone result (worker keeps copy)
   *
   * Set to false only if the worker needs to keep the result (e.g., caching).
   * Most processing is stateless and should use the default.
   */
  transferResult?: boolean
}
```

Dispatch options are applied via `task.with(options)`:

```ts
const result = await resize.with({ transfer: [image.data.buffer] }).process(image)
```

The returned proxy can be reused for multiple calls when options are stable:

```ts
const noTransfer = resize.with({ transfer: [] })
await noTransfer.process(imageA)
await noTransfer.process(imageB)
```

### Usage

```ts
// Example 1: Default auto-transfer (common case)
const result = await resize.process(imageData);
// Auto-detects imageData.data.buffer → transferred
// Fast, zero-copy both ways

// Example 2: Explicitly disable transfer
const result = await resize.with({ transfer: [] }).process(imageData);
// Clones imageData (~50ms for 10MB)
// Original imageData remains usable

// Example 3: Selective transfer (mixed data)
const lookupTable = new Float32Array(1000);

for (const image of images) {
  await colorCorrect.with({ transfer: [image.data.buffer] }).process(
    image,
    lookupTable
  );
  // lookupTable remains usable for next iteration
}

// Example 4: Worker keeps result (rare)
await encoder.with({ transferResult: false }).addFrame(frame);
// Worker's internal cache still has the frame
```

## Transferable Object Types

Using the `transferables` library, we detect:

- `ArrayBuffer` - Raw binary data
- `TypedArray.buffer` - Underlying buffer of Uint8Array, Float32Array, etc.
- `ImageBitmap` - Optimized bitmap for canvas operations
- `OffscreenCanvas` - Rendering context for workers
- `VideoFrame` - For video processing pipelines
- `AudioData` - For audio processing
- `MessagePort` - For worker communication channels
- `ReadableStream` / `WritableStream` / `TransformStream` - For streaming data

## Implementation Details

### Auto-detection Flow

```ts
// When user calls task method via task.with(options):
async dispatch(method: string, args: unknown[], options?: TaskDispatchOptions) {
  // 1. Determine transferables for arguments
  const transferables = options?.transfer ?? getTransferables(args)

  // 2. Dispatch to worker with transfer list
  const result = await workerDispatch(callId, method, args, transferables)

  // 3. Handle result transfer
  const shouldTransferResult = options?.transferResult ?? true
  if (shouldTransferResult && result != null) {
    const resultTransferables = getTransferables(result)
    if (resultTransferables.length > 0) {
      // Tag result for transfer back to main thread
      transfer(result, resultTransferables)
    }
  }

  return result
}
```

### Comlink Integration

Comlink uses a `WeakMap` to track transfer lists:

```ts
import { transfer } from 'comlink'

// Tag object for transfer
transfer(obj, [obj.buffer])

// Comlink automatically uses this list during postMessage
```

We integrate by:
1. Auto-detecting transferables from args
2. Calling `transfer()` to tag them
3. Comlink handles the actual postMessage with transfer list

## Use Cases

### Image Processing Pipeline

```ts
const runtime = createTaskRuntime();

const resize = runtime.defineTask<ResizeAPI>({
  type: 'parallel',
  worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
  poolSize: 4
});

// Process 100 images - all automatically transferred
for (const image of images) {
  const resized = await resize.process(image);
  // image.data.buffer transferred to worker (neutered)
  // resized.data.buffer transferred back (main owns it)
  display(resized);
}
```

### Reusable Configuration

```ts
// Load expensive lookup table once
const colorLUT = new Float32Array(256 * 256 * 256);
loadColorLookupTable(colorLUT);

// Process many images with same LUT
for (const image of images) {
  const corrected = await colorCorrect
    .with({ transfer: [image.data.buffer] })
    .process(image, colorLUT);
}
// colorLUT still intact for next batch
```

### Stateful Worker

```ts
// Worker maintains a cache
const handlers = {
  addFrame(frame: VideoFrame, ctx: TaskContext) {
    cache.set(frame.timestamp, frame);
    return { success: true, timestamp: frame.timestamp };
  }
};

// Main thread
await encoder.with({ transferResult: false }).addFrame(frame);
```

### Explicit Control (Debugging)

```ts
// Disable transfers to debug neutering issues
const result = await task.with({ transfer: [] }).process(data);

// After processing, data is still usable
console.log(data.buffer.byteLength); // Still has data
```

## Edge Cases and Tradeoffs

### Circular References

The `transferables` library handles circular references via `WeakSet`, preventing infinite loops.

### Deep Nesting

Auto-detection traverses up to 10 levels deep by default. Deeper structures are not scanned (performance tradeoff).

### Shared Objects

Transferables in multiple args are deduplicated:

```ts
const buffer = new ArrayBuffer(1024);
const view1 = new Uint8Array(buffer);
const view2 = new Uint32Array(buffer);

await task.process(view1, view2);
// Auto-detects both share same buffer → transfers buffer once
```

### SharedArrayBuffer

`SharedArrayBuffer` is **not** transferable (it's already shared). It will be cloned, which is fine since it's just a reference.

### Primitives and Small Objects

Auto-detection has minimal overhead for primitives/small objects:
- Primitives: Skipped immediately
- Small objects: Quick scan, no transferables found
- Large objects: Cost amortized by transfer savings

### Result Transfer Default

`transferResult: true` is the right default because:
- Most processing is stateless (worker doesn't need result after return)
- Matches the common pattern: process → return → discard
- Users working with stateful workers will know to opt-out via
  `task.with({ transferResult: false })`

## Performance Characteristics

| Data Size | Clone Time | Transfer Time | Savings |
|-----------|------------|---------------|---------|
| 1MB       | ~5ms       | ~0.001ms      | 5,000x  |
| 10MB      | ~50ms      | ~0.001ms      | 50,000x |
| 100MB     | ~500ms     | ~0.001ms      | 500,000x|

Transfer is essentially O(1), while clone is O(n) with data size.

## Migration Path

Auto-transfer works unchanged (it's transparent):

```ts
// Before: Manual Comlink transfer
import { transfer } from 'comlink';
await task.process(transfer(image, [image.data.buffer]));

// After: Automatic (same performance)
await task.process(image);

// If manual control needed: Explicit list
await task.with({ transfer: [image.data.buffer] }).process(image);
```

Note: Explicit dispatch options are applied via `task.with(...)`, not as a
trailing argument.

## Documentation Requirements

### User-Facing Docs

1. **Quick Start**: Show auto-transfer example with ImageData
2. **Performance Note**: Explain transfer vs clone tradeoffs
3. **Neutering Explanation**: Clear example of what happens to transferred objects
4. **Common Patterns**: Reusable config, pipelining, stateful workers
5. **Troubleshooting**: How to debug "buffer is detached" errors

### API Reference

- Add `transfer` and `transferResult` to `TaskDispatchOptions`
- Document default behavior (auto-detect)
- Link to MDN's Transferable objects reference

## Open Questions

None - design is ready for implementation.

## References

- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [transferables library](https://github.com/okikio/transferables)
- [Comlink transfer documentation](https://github.com/GoogleChromeLabs/comlink#transfer-handlers-and-event-listeners)
