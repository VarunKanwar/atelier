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

export type UploadPhase = 'upload' | 'running'

export type UploadState = {
  phase: UploadPhase
}

export const SPEED_SCALE = 1.5

export const INITIAL_ITEMS = 8
export const PREPROCESS_DURATION = 1000 * SPEED_SCALE
export const INFERENCE_DURATION = 1200 * SPEED_SCALE
export const THUMB_DURATION = 1000 * SPEED_SCALE
export const PREPROCESS_WORKERS = 4
export const THUMB_WORKERS = 4
export const INFERENCE_WORKERS = 1
export const ENTRY_INTERVAL = 200 * SPEED_SCALE
export const TRAVEL_DURATION = 500 * SPEED_SCALE // Minimum traversal time to keep motion legible.
export const EXIT_DURATION = 800 * SPEED_SCALE
export const UPLOAD_DURATION = 2000
export const UPLOAD_CLICK_CUE_DURATION = 1000

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
  const [thumbCompletedCount, setThumbCompletedCount] = useState(0)
  const [labelCompletedCount, setLabelCompletedCount] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [uploadState, setUploadState] = useState<UploadState>({ phase: 'upload' })
  const [uploadCueActive, setUploadCueActive] = useState(true)
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: cycle triggers upload phase reset
  useEffect(() => {
    setUploadState({ phase: 'upload' })
    setUploadCueActive(false)
    const cueStartDelay = Math.max(0, UPLOAD_DURATION - UPLOAD_CLICK_CUE_DURATION)
    const cueTimer = globalThis.setTimeout(() => {
      setUploadCueActive(true)
    }, cueStartDelay)
    const uploadTimer = globalThis.setTimeout(() => {
      setUploadState({ phase: 'running' })
      setUploadCueActive(false)
    }, UPLOAD_DURATION)
    return () => {
      clearTimeout(cueTimer)
      clearTimeout(uploadTimer)
    }
  }, [cycle])

  useEffect(() => {
    const tickRate = 50
    const interval = setInterval(() => {
      if (!isVisibleRef.current) return
      const now = Date.now()

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Single-pass state machine keeps timings consistent.
      setItems(prevItems => {
        const newItems: PipelineItem[] = []
        let hasChanges = false

        // --- 1. NEW ITEM ENTRY ---
        // Spawn items into the preprocess queue at a steady cadence.
        if (
          uploadState.phase === 'running' &&
          inputCount > 0 &&
          now - lastEntryTime.current > ENTRY_INTERVAL
        ) {
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
        const preprocessQueue: PipelineItem[] = []
        const inferenceQueue: PipelineItem[] = []
        const thumbQueue: PipelineItem[] = []
        let preprocessActive = 0
        let inferenceActive = 0
        let thumbActive = 0

        for (const item of prevItems) {
          if (item.stage === 'preprocess-queue') preprocessQueue.push(item)
          else if (item.stage === 'inference-queue') inferenceQueue.push(item)
          else if (item.stage === 'thumb-queue') thumbQueue.push(item)
          else if (item.stage === 'preprocess') preprocessActive += 1
          else if (item.stage === 'inference-process') inferenceActive += 1
          else if (item.stage === 'thumb-process') thumbActive += 1
        }

        preprocessQueue.sort((a, b) => a.enteredStageAt - b.enteredStageAt)
        inferenceQueue.sort((a, b) => a.enteredStageAt - b.enteredStageAt)
        thumbQueue.sort((a, b) => a.enteredStageAt - b.enteredStageAt)

        const preprocessHeadId = preprocessQueue[0]?.id
        const inferenceHeadId = inferenceQueue[0]?.id
        const thumbHeadId = thumbQueue[0]?.id

        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Explicit transitions preserve clarity for the demo.
        const processedItems = prevItems.map((item): PipelineItem => {
          const elapsed = now - item.enteredStageAt

          // Preprocess Queue -> Process
          if (item.stage === 'preprocess-queue') {
            const canProcess = preprocessActive < PREPROCESS_WORKERS && preprocessHeadId === item.id
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
            const nextItem: PipelineItem = {
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
            const canProcess = inferenceActive < INFERENCE_WORKERS && inferenceHeadId === item.id
            const hasTraveled = elapsed > TRAVEL_DURATION

            if (canProcess && hasTraveled) {
              hasChanges = true
              return { ...item, stage: 'inference-process', enteredStageAt: now }
            }
          }

          // Inference Process -> Done
          if (item.stage === 'inference-process' && elapsed > INFERENCE_DURATION) {
            hasChanges = true
            return { ...item, stage: 'done', enteredStageAt: now }
          }

          // Thumbnail Queue -> Process
          // Only start when a worker is free and the item has traversed the path.
          if (item.stage === 'thumb-queue') {
            const canProcess = thumbActive < THUMB_WORKERS && thumbHeadId === item.id
            const hasTraveled = elapsed > TRAVEL_DURATION

            if (canProcess && hasTraveled) {
              hasChanges = true
              return { ...item, stage: 'thumb-process', enteredStageAt: now }
            }
          }

          // Thumbnail Process -> Done
          if (item.stage === 'thumb-process' && elapsed > THUMB_DURATION) {
            hasChanges = true
            return { ...item, stage: 'done', enteredStageAt: now }
          }

          return item
        })

        // --- 3. CLEANUP & LOOP ---
        // Remove completed items after their exit animation.
        let completedDelta = 0
        let thumbDelta = 0
        let labelDelta = 0
        const finalItems = [...processedItems, ...newItems].filter(item => {
          // Allow done items to animate off-screen before removal.
          if (item.stage === 'done') {
            if (now - item.enteredStageAt > EXIT_DURATION) {
              completedDelta += 0.5
              if (item.type === 'thumb') thumbDelta += 1
              if (item.type === 'inference') labelDelta += 1
              return false
            }
          }
          return true
        })

        if (completedDelta > 0) {
          setCompletedCount(c => c + completedDelta)
        }
        if (thumbDelta > 0) {
          setThumbCompletedCount(c => c + thumbDelta)
        }
        if (labelDelta > 0) {
          setLabelCompletedCount(c => c + labelDelta)
        }

        if (!hasChanges && newItems.length === 0 && finalItems.length === prevItems.length)
          return prevItems
        return finalItems
      })
    }, tickRate)

    return () => clearInterval(interval)
  }, [inputCount, uploadState.phase])

  // Auto-loop once all items have drained.
  useEffect(() => {
    if (inputCount === 0 && items.length === 0) {
      const timer = setTimeout(() => {
        // Reset simulation state for the next loop.
        setInputCount(INITIAL_ITEMS)
        setCompletedCount(0)
        setThumbCompletedCount(0)
        setLabelCompletedCount(0)
        nextId.current = 0
        lastEntryTime.current = 0
        setCycle(current => current + 1)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [inputCount, items.length])

  return {
    items,
    completedCount: Math.floor(completedCount),
    thumbCompletedCount,
    labelCompletedCount,
    cycle,
    uploadState,
    uploadCueActive,
  }
}
