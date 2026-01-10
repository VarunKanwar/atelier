import { useEffect, useMemo, useState } from 'react'

import type { RuntimeSnapshot, RuntimeSnapshotSubscriptionOptions, TaskRuntime } from '../../src'

export type UseRuntimeSnapshotOptions = RuntimeSnapshotSubscriptionOptions & {
  enabled?: boolean
}

export const useRuntimeSnapshot = (
  runtime: TaskRuntime,
  options: UseRuntimeSnapshotOptions = {}
): { snapshot: RuntimeSnapshot; updatedAt: number } => {
  const { enabled = true, intervalMs = 250, emitImmediately = true, onlyOnChange = true } = options
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() => runtime.getRuntimeSnapshot())
  const [updatedAt, setUpdatedAt] = useState(() => Date.now())
  const subscriptionOptions = useMemo(
    () => ({
      intervalMs,
      emitImmediately,
      onlyOnChange,
    }),
    [emitImmediately, intervalMs, onlyOnChange]
  )

  useEffect(() => {
    if (!enabled) return
    const unsubscribe = runtime.subscribeRuntimeSnapshot((next: RuntimeSnapshot) => {
      setSnapshot(next)
      setUpdatedAt(Date.now())
    }, subscriptionOptions)
    return () => {
      unsubscribe()
    }
  }, [enabled, runtime, subscriptionOptions])

  return { snapshot, updatedAt }
}
