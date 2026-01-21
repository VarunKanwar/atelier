import type { AbortTaskController } from './abort-task-controller'

/**
 * parallelLimit
 *
 * Motivation:
 * - Provide pipeline-level backpressure without requiring a DSL.
 *
 * Design:
 * - Limits in-flight async operations and yields results in completion order.
 *
 * Usage:
 * - Wrap your pipeline entrypoint to cap concurrency across items.
 */

/**
 * Execute operations with a concurrency limit, yielding results as they complete
 *
 * @param items - Items to process
 * @param limit - Maximum number of concurrent operations
 * @param fn - Async function to execute for each item
 * @param options - Error policy, callbacks, and cancellation controls
 * @yields Results in completion order
 *
 * @example
 * ```typescript
 * const documents = [doc1, doc2, doc3, ...]
 *
 * for await (const result of parallelLimit(documents, 10, processDocument)) {
 *   console.log('Completed:', result)
 * }
 * ```
 */
// Error policy controls whether rejections stop the iterator or are skipped.
export type ParallelLimitErrorPolicy = 'fail-fast' | 'continue'

export type ParallelLimitResult<R, T = unknown> =
  | { status: 'fulfilled'; value: R; item: T }
  | { status: 'rejected'; error: unknown; item: T }

export type ParallelLimitOptions<T> = {
  signal?: AbortSignal
  abortTaskController?: AbortTaskController
  keyOf?: (item: T) => string
  // Default is fail-fast; set to 'continue' to skip failed items.
  errorPolicy?: ParallelLimitErrorPolicy
  // Hook for logging/metrics without altering control flow.
  onError?: (error: unknown, item: T) => void
}

export type ParallelLimitSettledOptions<T> = {
  signal?: AbortSignal
  abortTaskController?: AbortTaskController
  keyOf?: (item: T) => string
  // Yield {status, value|error, item} for each item and never throw.
  returnSettled: true
  onError?: (error: unknown, item: T) => void
}

export function parallelLimit<T, R>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
  options?: ParallelLimitOptions<T>
): AsyncGenerator<R, void, unknown>
export function parallelLimit<T, R>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
  options: ParallelLimitSettledOptions<T>
): AsyncGenerator<ParallelLimitResult<R, T>, void, unknown>
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Pipeline orchestration with cancellation, error policies, and backpressure
export async function* parallelLimit<T, R>(
  items: Iterable<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
  options: ParallelLimitOptions<T> | ParallelLimitSettledOptions<T> = {}
): AsyncGenerator<R | ParallelLimitResult<R, T>, void, unknown> {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error('parallelLimit requires a limit of at least 1')
  }

  const iterator = items[Symbol.iterator]()
  type Completion = ParallelLimitResult<R, T> & { key?: string }
  type ExecutingEntry = { completion: Completion; wrapped: Promise<ExecutingEntry> }
  const executing = new Set<Promise<ExecutingEntry>>()
  const returnSettled = (options as ParallelLimitSettledOptions<T>).returnSettled === true
  const errorPolicy = returnSettled
    ? 'continue'
    : ((options as ParallelLimitOptions<T>).errorPolicy ?? 'fail-fast')
  const onError = (options as ParallelLimitOptions<T>).onError
  const abortTaskController = (options as ParallelLimitOptions<T>).abortTaskController
  const keyOf = (options as ParallelLimitOptions<T>).keyOf
  const signal = (options as ParallelLimitOptions<T>).signal
  const cancellationEnabled = Boolean(signal || abortTaskController)

  function startNext(): boolean {
    if (signal?.aborted) return false

    let next = iterator.next()
    while (!next.done) {
      const value = next.value
      const key = resolveKey(keyOf, value)
      if (key && abortTaskController?.isAborted(key)) {
        next = iterator.next()
        continue
      }

      // Wrap each promise so we can both track completion order and
      // remove the correct promise from the in-flight set on settle.
      const base = Promise.resolve()
        .then(() => fn(value))
        .then(
          result => ({ status: 'fulfilled', value: result, item: value, key }) as const,
          error => ({ status: 'rejected', error, item: value, key }) as const
        )

      let wrapped: Promise<ExecutingEntry>
      wrapped = base.then(completion => ({ completion, wrapped }))
      executing.add(wrapped)
      return true
    }
    return false
  }

  // Fill initial batch up to limit
  while (executing.size < limit && startNext()) {
    // Keep filling
  }

  // Yield results as they complete, refilling the queue
  while (executing.size > 0) {
    // Promise.race gives completion-order streaming.
    const { completion, wrapped } = await Promise.race(executing)
    executing.delete(wrapped)
    const keyAborted = completion.key
      ? (abortTaskController?.isAborted(completion.key) ?? false)
      : false

    if (completion.status === 'rejected') {
      onError?.(completion.error, completion.item)
      if (returnSettled) {
        yield completion
      } else if (cancellationEnabled && (keyAborted || isAbortError(completion.error))) {
        // Skip aborted errors when cancellation is enabled.
      } else if (errorPolicy === 'continue') {
        // Skip yielding errors when continuing
      } else {
        throw completion.error
      }
    } else if (returnSettled) {
      yield completion
    } else if (cancellationEnabled && keyAborted) {
      // Drop results for aborted keys by default.
    } else {
      yield completion.value
    }

    while (executing.size < limit && startNext()) {
      // Keep queue full
    }
  }
}

/**
 * Simple helper to yield promises in completion order
 * Does not limit concurrency - use parallelLimit for that
 *
 * @param promises - Array of promises
 * @yields Results in completion order
 */
export async function* yieldAsCompleted<T>(
  promises: Promise<T>[]
): AsyncGenerator<T, void, unknown> {
  const pending = new Set<Promise<{ value: T; promise: Promise<T> }>>()
  const wrappedByOriginal = new Map<Promise<T>, Promise<{ value: T; promise: Promise<T> }>>()

  for (const promise of promises) {
    // Tag each promise so we can remove by identity, not by value.
    const wrapped = promise.then(value => ({ value, promise }))
    wrappedByOriginal.set(promise, wrapped)
    pending.add(wrapped)
  }

  while (pending.size > 0) {
    const { value, promise } = await Promise.race(pending)
    const wrapped = wrappedByOriginal.get(promise)
    if (wrapped) {
      pending.delete(wrapped)
      wrappedByOriginal.delete(promise)
    }
    yield value
  }
}

const resolveKey = <T>(keyOf: ((item: T) => string) | undefined, item: T): string | undefined => {
  if (!keyOf) return undefined
  const key = keyOf(item)
  if (typeof key !== 'string') return undefined
  if (key.length === 0) return undefined
  return key
}

const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  return (error as { name?: string }).name === 'AbortError'
}
