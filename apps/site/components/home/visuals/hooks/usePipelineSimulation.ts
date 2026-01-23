import { useEffect, useState, useRef } from 'react'

export type PipelineStage = 
  | 'start' 
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

export const INITIAL_ITEMS = 20
export const PREPROCESS_DURATION = 1000
export const INFERENCE_DURATION = 1400
export const THUMB_DURATION = 1000      
export const PREPROCESS_WORKERS = 4
export const THUMB_WORKERS = 4
export const INFERENCE_WORKERS = 1
export const ENTRY_INTERVAL = 400 
export const TRAVEL_DURATION = 500 // Min time to travel along the edge

export const usePipelineSimulation = () => {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [inputCount, setInputCount] = useState(INITIAL_ITEMS)
  const [completedCount, setCompletedCount] = useState(0)
  
  const lastEntryTime = useRef(0)
  const nextId = useRef(0)

  useEffect(() => {
    const tickRate = 50 
    const interval = setInterval(() => {
      const now = Date.now()
      
      setItems(prevItems => {
        let newItems: PipelineItem[] = []
        let hasChanges = false

        // --- 1. NEW ITEM ENTRY ---
        // Spawns new items into Preprocess at a set interval
        if (inputCount > 0 && now - lastEntryTime.current > ENTRY_INTERVAL) {
           const inPreprocess = prevItems.filter(i => i.stage === 'preprocess').length
           if (inPreprocess < PREPROCESS_WORKERS && nextId.current < INITIAL_ITEMS) {
              const id = nextId.current++
              newItems.push({
                id: String(id),
                originalId: id,
                type: 'main',
                stage: 'preprocess' as PipelineStage,
                enteredStageAt: now,
                label: `img-${id}`
              })
              lastEntryTime.current = now
              setInputCount(c => c - 1)
              hasChanges = true
           }
        }

        // --- 2. STATE MACHINE TRANSITIONS ---
        // Handles movement between stages based on duration and worker availability
        const processedItems = prevItems.map(item => {
           let nextItem = { ...item }
           const elapsed = now - item.enteredStageAt
           
           // Preprocess -> Split
           if (item.stage === 'preprocess' && elapsed > PREPROCESS_DURATION) {
                 hasChanges = true
                 // Transform to Inference Packet
                 nextItem = {
                    ...item,
                    id: `${item.originalId}-infer`,
                    type: 'inference' as 'inference',
                    stage: 'inference-queue' as PipelineStage,
                    enteredStageAt: now
                 }
                 // Spawn Thumbnail Packet
                 newItems.push({
                    originalId: item.originalId,
                    id: `${item.originalId}-thumb`,
                    type: 'thumb',
                    stage: 'thumb-queue' as PipelineStage,
                    enteredStageAt: now,
                    label: item.label
                 })
                 return nextItem
            }
            
            // Inference Queue -> Process
            // Enforce TRAVEL_DURATION to allow visual traversal along the edge
            if (item.stage === 'inference-queue') {
                 const activeWorkers = prevItems.filter(i => i.stage === 'inference-process').length
                 const queue = prevItems.filter(i => i.stage === 'inference-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 
                 const canProcess = activeWorkers < INFERENCE_WORKERS && queue[0]?.id === item.id
                 const hasTraveled = elapsed > TRAVEL_DURATION

                 if (canProcess && hasTraveled) {
                    hasChanges = true
                    return { ...item, stage: 'inference-process' as PipelineStage, enteredStageAt: now }
                 }
            }
            
            // Inference Process -> Done
            if (item.stage === 'inference-process' && elapsed > INFERENCE_DURATION) {
                 hasChanges = true
                 setCompletedCount(c => c + 0.5)
                 return { ...item, stage: 'done' as PipelineStage, enteredStageAt: now }
            }
            
            // Thumbnail Queue -> Process
            // Enforce TRAVEL_DURATION so items don't teleport if workers are free
            if (item.stage === 'thumb-queue') {
                 const activeWorkers = prevItems.filter(i => i.stage === 'thumb-process').length
                 const queue = prevItems.filter(i => i.stage === 'thumb-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 
                 const canProcess = activeWorkers < THUMB_WORKERS && queue[0]?.id === item.id
                 const hasTraveled = elapsed > TRAVEL_DURATION

                 if (canProcess && hasTraveled) {
                    hasChanges = true
                    return { ...item, stage: 'thumb-process' as PipelineStage, enteredStageAt: now }
                 }
            }
            
            // Thumbnail Process -> Done
            if (item.stage === 'thumb-process' && elapsed > THUMB_DURATION) {
                 hasChanges = true
                 setCompletedCount(c => c + 0.5)
                 return { ...item, stage: 'done' as PipelineStage, enteredStageAt: now }
            }
            
            return item
        })

        // --- 3. CLEANUP & LOOP ---
        // Remove completed items and trigger auto-restart logic
        const finalItems = [...processedItems, ...newItems].filter(item => {
           // Allow 'done' items to animate off-screen before removal
           if (item.stage === 'done') {
              if (now - item.enteredStageAt > 1000) return false 
           }
           return true
        })

        if (!hasChanges && newItems.length === 0 && finalItems.length === prevItems.length) return prevItems
        return finalItems
      })
      
    }, tickRate)
    
    return () => clearInterval(interval)
  }, [inputCount])
  
  // Separate Effect for Auto-Loop to avoid side-effects in the tick
  useEffect(() => {
     if (inputCount === 0 && items.length === 0) {
        const timer = setTimeout(() => {
           // RESET SIMULATION
           setInputCount(INITIAL_ITEMS)
           setCompletedCount(0)
           nextId.current = 0 // Critical: Reset ID counter so new items can spawn
        }, 1500) 
        return () => clearTimeout(timer)
     }
  }, [inputCount, items.length])

  return {
    items,
    inputCount,
    completedCount: Math.floor(completedCount)
  }
}
