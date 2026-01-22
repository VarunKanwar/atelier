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
  id: string // composite id for split items e.g. "1-thumb"
  originalId: number
  type: 'main' | 'thumb' | 'inference'
  stage: PipelineStage
  enteredStageAt: number
  label: string
}

export type PipelineState = {
  items: PipelineItem[]
  inputCount: number
  completedCount: number
}

const INITIAL_ITEMS = 20
const PREPROCESS_DURATION = 800
const INFERENCE_DURATION = 2500 // Slow!
const THUMB_DURATION = 400      // Fast!

// Stagger entry every 800ms
const ENTRY_INTERVAL = 800

export const usePipelineSimulation = () => {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [inputCount, setInputCount] = useState(INITIAL_ITEMS)
  const [completedCount, setCompletedCount] = useState(0)
  
  // Refs for tracking across intervals without re-renders
  const lastEntryTime = useRef(0)
  const nextId = useRef(0)

  useEffect(() => {
    const tickRate = 100 // Check state 10 times a second
    const interval = setInterval(() => {
      const now = Date.now()
      
      setItems(prevItems => {
        let nextItems = [...prevItems]
        let newItems: PipelineItem[] = []
        let hasChanges = false

        // 1. ENTRY LOGIC
        // If we have remaining input and enough time passed, spawn a new item
        if (inputCount > 0 && now - lastEntryTime.current > ENTRY_INTERVAL) {
           // Check if Preprocess is free (Rate Limit: Max 1 in preprocess for visual clarity)
           // Actually, let's allow overlapping preprocess slightly, but visually 1 pipe.
           // Let's enforce strictly 1 in preprocess to make the "flow" very clear
           const inPreprocess = prevItems.some(i => i.stage === 'preprocess')
           if (!inPreprocess && nextId.current < INITIAL_ITEMS) {
              const id = nextId.current++
              newItems.push({
                id: String(id),
                originalId: id,
                type: 'main',
                stage: 'preprocess',
                enteredStageAt: now,
                label: `img-${id}`
              })
              lastEntryTime.current = now
              setInputCount(c => c - 1)
              hasChanges = true
           }
        }

        // 2. STATE TRANSITIONS
        nextItems = nextItems.map(item => {
           // PREPROCESS -> SPLIT
           if (item.stage === 'preprocess') {
              if (now - item.enteredStageAt > PREPROCESS_DURATION) {
                 // Item finishes preprocessing.
                 // It effectively "disappears" and spawns two new items (Thumb & Inference)
                 // We handle this by mutating current item to one type, and pushing a new one.
                 
                 // Transform current to Inference (Consumer 1)
                 hasChanges = true
                 return {
                    ...item,
                    id: `${item.originalId}-infer`,
                    type: 'inference' as const,
                    stage: 'inference-queue' as const,
                    enteredStageAt: now
                 }
              }
           }
           
           // INFERENCE QUEUE -> PROCESS
           if (item.stage === 'inference-queue') {
              // Worker Logic: Is the "Inference Worker" free?
              const activeWorkers = prevItems.filter(i => i.stage === 'inference-process').length
              // Strict bottleneck: 1 at a time
              if (activeWorkers === 0) {
                 // Check if this item is the "first" in line?
                 // Simple FIFO: Find all in queue, sort by entry time.
                 const queue = prevItems.filter(i => i.stage === 'inference-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 if (queue[0]?.id === item.id) {
                    hasChanges = true
                    return { ...item, stage: 'inference-process' as const, enteredStageAt: now }
                 }
              }
           }

           // INFERENCE PROCESS -> DONE
           if (item.stage === 'inference-process') {
              if (now - item.enteredStageAt > INFERENCE_DURATION) {
                 hasChanges = true
                 return { ...item, stage: 'done' as const, enteredStageAt: now }
              }
           }

           // THUMB QUEUE -> PROCESS
           if (item.stage === 'thumb-queue') {
              // Worker Logic: Thumb pool has size 4 (example)
              const activeWorkers = prevItems.filter(i => i.stage === 'thumb-process').length
              if (activeWorkers < 3) {
                 hasChanges = true
                 return { ...item, stage: 'thumb-process' as const, enteredStageAt: now }
              }
           }

           // THUMB PROCESS -> DONE
           if (item.stage === 'thumb-process') {
              if (now - item.enteredStageAt > THUMB_DURATION) {
                 hasChanges = true
                 return { ...item, stage: 'done' as const, enteredStageAt: now }
              }
           }

           return item
        })
        
        // 3. HANDLE BIFURCATION SPAWNS
        // If we successfully turned an item into 'inference-queue', we must spawn the buddy 'thumb-queue'
        // We detect this by looking for items that JUST switched to inference-queue this tick
        // (Wait, `map` creates a new array, difficult to diff inside the setter)
        // Alternative: Start of loop, find items in Preprocess that are about to finish.
        
        // Simpler way:
        // Iterate original list again. If item WAS preprocess and is NOW inference-queue (logic above), 
        // we add the buddy.
        // Actually, let's keep it clean:
        // Inside the map above, we transformed `item`.
        // If we transformed it to `inference-queue`, we push a new `thumb-queue` item to `newItems`.
        
        // Let's retry the map logic cleanly:
        const processedItems: PipelineItem[] = []
        for (const item of prevItems) {
            let nextItem = item
            
            if (item.stage === 'preprocess' && now - item.enteredStageAt > PREPROCESS_DURATION) {
                 // SPLIT HAPPENS HERE
                 hasChanges = true
                 
                 // 1. Create Inference Item
                 nextItem = {
                    ...item,
                    id: `${item.originalId}-infer`,
                    type: 'inference',
                    stage: 'inference-queue',
                    enteredStageAt: now
                 }
                 
                 // 2. Spawn Thumb Item
                 newItems.push({
                    ...item,
                    id: `${item.originalId}-thumb`,
                    type: 'thumb',
                    stage: 'thumb-queue',
                    enteredStageAt: now
                 })
            }
            
            else if (item.stage === 'inference-queue') {
                 const activeWorkers = prevItems.filter(i => i.stage === 'inference-process').length
                 // Only verify against PREVIOUS state to avoid race conditions in this tick
                 const queue = prevItems.filter(i => i.stage === 'inference-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 if (activeWorkers === 0 && queue[0]?.id === item.id) {
                    hasChanges = true
                    nextItem = { ...item, stage: 'inference-process', enteredStageAt: now }
                 }
            }
            
            else if (item.stage === 'inference-process' && now - item.enteredStageAt > INFERENCE_DURATION) {
                 hasChanges = true
                 nextItem = { ...item, stage: 'done', enteredStageAt: now }
                 setCompletedCount(c => c + 0.5) // Half a task done
            }
            
            else if (item.stage === 'thumb-queue') {
                 const activeWorkers = prevItems.filter(i => i.stage === 'thumb-process').length
                 if (activeWorkers < 3) {
                    hasChanges = true
                    nextItem = { ...item, stage: 'thumb-process', enteredStageAt: now }
                 }
            }
            
            else if (item.stage === 'thumb-process' && now - item.enteredStageAt > THUMB_DURATION) {
                 hasChanges = true
                 nextItem = { ...item, stage: 'done', enteredStageAt: now }
                 setCompletedCount(c => c + 0.5)
            }
            
            processedItems.push(nextItem)
        }

        if (!hasChanges && newItems.length === 0) return prevItems
        return [...processedItems, ...newItems]
      })
      
    }, tickRate)
    
    return () => clearInterval(interval)
  }, [inputCount]) // Re-bind if inputCount needed? No, use ref or state callback.

  return {
    items,
    inputCount,
    completedCount: Math.floor(completedCount)
  }
}
