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

export const usePipelineSimulation = () => {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [inputCount, setInputCount] = useState(INITIAL_ITEMS)
  const [completedCount, setCompletedCount] = useState(0)
  
  const lastEntryTime = useRef(0)
  const nextId = useRef(0)

  useEffect(() => {
    const tickRate = 50 // Higher resolution for smoother transitions
    const interval = setInterval(() => {
      const now = Date.now()
      
      setItems(prevItems => {
        let newItems: PipelineItem[] = []
        let hasChanges = false

        // 1. ENTRY LOGIC
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

        // 2. STATE TRANSITIONS
        const processedItems = prevItems.map(item => {
           let nextItem = { ...item }
           
           if (item.stage === 'preprocess' && now - item.enteredStageAt > PREPROCESS_DURATION) {
                 hasChanges = true
                 // Transform to Inference
                 nextItem = {
                    ...item,
                    id: `${item.originalId}-infer`,
                    type: 'inference' as 'inference',
                    stage: 'inference-queue' as PipelineStage,
                    enteredStageAt: now
                 }
                 // Spawn Thumb buddy
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
            
            if (item.stage === 'inference-queue') {
                 const activeWorkers = prevItems.filter(i => i.stage === 'inference-process').length
                 const queue = prevItems.filter(i => i.stage === 'inference-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 if (activeWorkers < INFERENCE_WORKERS && queue[0]?.id === item.id) {
                    hasChanges = true
                    return { ...item, stage: 'inference-process' as PipelineStage, enteredStageAt: now }
                 }
            }
            
            if (item.stage === 'inference-process' && now - item.enteredStageAt > INFERENCE_DURATION) {
                 hasChanges = true
                 setCompletedCount(c => c + 0.5)
                 return { ...item, stage: 'done' as PipelineStage, enteredStageAt: now }
            }
            
            if (item.stage === 'thumb-queue') {
                 const activeWorkers = prevItems.filter(i => i.stage === 'thumb-process').length
                 const queue = prevItems.filter(i => i.stage === 'thumb-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 if (activeWorkers < THUMB_WORKERS && queue[0]?.id === item.id) {
                    hasChanges = true
                    return { ...item, stage: 'thumb-process' as PipelineStage, enteredStageAt: now }
                 }
            }
            
            if (item.stage === 'thumb-process' && now - item.enteredStageAt > THUMB_DURATION) {
                 hasChanges = true
                 setCompletedCount(c => c + 0.5)
                 return { ...item, stage: 'done' as PipelineStage, enteredStageAt: now }
            }
            
            return item
        })

        // 3. CLEANUP
        // Remove done items after they have had time to animate out (e.g., 500ms)
        const finalItems = [...processedItems, ...newItems].filter(item => {
           if (item.stage === 'done') {
              if (now - item.enteredStageAt > 600) return false // Remove after 600ms
           }
           return true
        })

        if (!hasChanges && newItems.length === 0 && finalItems.length === prevItems.length) return prevItems
        return finalItems
      })
      
    }, tickRate)
    
    return () => clearInterval(interval)
  }, [inputCount])

  return {
    items,
    inputCount,
    completedCount: Math.floor(completedCount)
  }
}
