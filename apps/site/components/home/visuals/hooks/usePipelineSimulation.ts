import { useEffect, useRef, useState } from 'react'

export type PipelineStage =
  | 'preprocess-queue'
  | 'preprocess'
  | 'inference-queue'
  | 'inference-process'
  | 'thumb-queue'
  | 'thumb-process'
  | 'done'

export type PipelineItem = {
  id: string // composite id for split items e.g. "1-infer"
  originalId: number
  type: 'main' | 'thumb' | 'inference'
  stage: PipelineStage
  enteredStageAt: number
  label: string
}

export const SPEED_SCALE = 1

export const INITIAL_ITEMS = 10
export const PREPROCESS_DURATION = 1000 * SPEED_SCALE
export const INFERENCE_DURATION = 1400 * SPEED_SCALE
export const THUMB_DURATION = 1000 * SPEED_SCALE
export const PREPROCESS_WORKERS = 4
export const THUMB_WORKERS = 4
export const INFERENCE_WORKERS = 1
export const ENTRY_INTERVAL = 400 * SPEED_SCALE
export const TRAVEL_DURATION = 500 * SPEED_SCALE // Minimum traversal time to keep motion legible.
export const EXIT_DURATION = 800 * SPEED_SCALE

/*
 * Intent: feed the hero animation with a simple, deterministic workflow model.
 * This models a DAG with fan-out, queueing, and a singleton bottleneck so the
 * visual reads like orchestration rather than a decorative animation.
 * It is illustrative, not a production scheduler.
 */
export const usePipelineSimulation = () => {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [inputCount, setInputCount] = useState(INITIAL_ITEMS)
  const [completedCount, setCompletedCount] = useState(0)
  const [cycle, setCycle] = useState(0)
  const isVisibleRef = useRef(true)

  const lastEntryTime = useRef(0)
  const nextId = useRef(0)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleVisibility = () => {
      isVisibleRef.current = !document.hidden
    }
    handleVisibility()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useEffect(() => {
    const tickRate = 50
    const interval = setInterval(() => {
      if (!isVisibleRef.current) return
      const now = Date.now()

      setItems(prevItems => {
        const newItems: PipelineItem[] = []
        let hasChanges = false

        // --- 1. NEW ITEM ENTRY ---
        // Spawn items into the preprocess queue at a steady cadence.
        if (inputCount > 0 && now - lastEntryTime.current > ENTRY_INTERVAL) {
          if (nextId.current < INITIAL_ITEMS) {
            const id = nextId.current++
            newItems.push({
              id: String(id),
              originalId: id,
              type: 'main',
              stage: 'preprocess-queue',
              enteredStageAt: now,
              label: `img-${id}`,
            })
            lastEntryTime.current = now
            setInputCount(c => c - 1)
            hasChanges = true
          }
        }

        // --- 2. STATE MACHINE TRANSITIONS ---
        // Advance items based on duration and worker availability.
        const processedItems = prevItems.map(item => {
          let nextItem = { ...item }
          const elapsed = now - item.enteredStageAt

          // Preprocess Queue -> Process
          if (item.stage === 'preprocess-queue') {
            const activeWorkers = prevItems.filter(i => i.stage === 'preprocess').length
            const queue = prevItems
              .filter(i => i.stage === 'preprocess-queue')
              .sort((a, b) => a.enteredStageAt - b.enteredStageAt)

            const canProcess = activeWorkers < PREPROCESS_WORKERS && queue[0]?.id === item.id
            const hasTraveled = elapsed > TRAVEL_DURATION

            if (canProcess && hasTraveled) {
              hasChanges = true
              return { ...item, stage: 'preprocess', enteredStageAt: now }
            }
          }

          // Preprocess -> Split
          if (item.stage === 'preprocess' && elapsed > PREPROCESS_DURATION) {
            hasChanges = true
            // Split into the inference branch...
            nextItem = {
              ...item,
              id: `${item.originalId}-infer`,
              type: 'inference',
              stage: 'inference-queue',
              enteredStageAt: now,
            }
            // ...and the thumbnail branch.
            newItems.push({
              originalId: item.originalId,
              id: `${item.originalId}-thumb`,
              type: 'thumb',
              stage: 'thumb-queue',
              enteredStageAt: now,
              label: item.label,
            })
            return nextItem
          }

          // Inference Queue -> Process
          // Only start when a worker is free and the item has traversed the path.
          if (item.stage === 'inference-queue') {
            const activeWorkers = prevItems.filter(i => i.stage === 'inference-process').length
            const queue = prevItems
              .filter(i => i.stage === 'inference-queue')
              .sort((a, b) => a.enteredStageAt - b.enteredStageAt)

            const canProcess = activeWorkers < INFERENCE_WORKERS && queue[0]?.id === item.id
            const hasTraveled = elapsed > TRAVEL_DURATION

            if (canProcess && hasTraveled) {
              hasChanges = true
              return { ...item, stage: 'inference-process', enteredStageAt: now }
            }
          }

          // Inference Process -> Done
          if (item.stage === 'inference-process' && elapsed > INFERENCE_DURATION) {
            hasChanges = true
            // Each original item completes twice (infer + thumb), so count half.
            setCompletedCount(c => c + 0.5)
            return { ...item, stage: 'done', enteredStageAt: now }
          }

          // Thumbnail Queue -> Process
          // Only start when a worker is free and the item has traversed the path.
          if (item.stage === 'thumb-queue') {
            const activeWorkers = prevItems.filter(i => i.stage === 'thumb-process').length
            const queue = prevItems
              .filter(i => i.stage === 'thumb-queue')
              .sort((a, b) => a.enteredStageAt - b.enteredStageAt)

            const canProcess = activeWorkers < THUMB_WORKERS && queue[0]?.id === item.id
            const hasTraveled = elapsed > TRAVEL_DURATION

            if (canProcess && hasTraveled) {
              hasChanges = true
              return { ...item, stage: 'thumb-process', enteredStageAt: now }
            }
          }

          // Thumbnail Process -> Done
          if (item.stage === 'thumb-process' && elapsed > THUMB_DURATION) {
            hasChanges = true
            // Each original item completes twice (infer + thumb), so count half.
            setCompletedCount(c => c + 0.5)
            return { ...item, stage: 'done', enteredStageAt: now }
          }

          return item
        })

        // --- 3. CLEANUP & LOOP ---
        // Remove completed items after their exit animation.
        const finalItems = [...processedItems, ...newItems].filter(item => {
          // Allow done items to animate off-screen before removal.
          if (item.stage === 'done') {
            if (now - item.enteredStageAt > EXIT_DURATION) return false
          }
          return true
        })

        if (!hasChanges && newItems.length === 0 && finalItems.length === prevItems.length)
          return prevItems
        return finalItems
      })
    }, tickRate)

    return () => clearInterval(interval)
  }, [inputCount])

  // Auto-loop once all items have drained.
  useEffect(() => {
    if (inputCount === 0 && items.length === 0) {
      const timer = setTimeout(() => {
        // Reset simulation state for the next loop.
        setInputCount(INITIAL_ITEMS)
        setCompletedCount(0)
        nextId.current = 0
        lastEntryTime.current = 0
        setCycle(current => current + 1)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [inputCount, items.length])

  return {
    items,
    inputCount,
    completedCount: Math.floor(completedCount),
    cycle,
  }
}
