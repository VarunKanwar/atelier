import { useEffect, useState, useRef, useCallback } from 'react'

export type PipelineStage = 
  | 'start' 
  | 'preprocess' 
  | 'inference-queue' 
  | 'inference-process' 
  | 'thumb-queue' 
  | 'thumb-process' 
  | 'done'

export type PipelineItem = {
  id: string
  originalId: number
  type: 'main' | 'thumb' | 'inference'
  stage: PipelineStage
  enteredStageAt: number
}

const INITIAL_ITEMS = 20 // Restore to 20 as requested
const PREPROCESS_DURATION = 800
const INFERENCE_DURATION = 2000
const THUMB_DURATION = 400
const ENTRY_INTERVAL = 600

export const usePipelineSimulation = () => {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [inputCount, setInputCount] = useState(INITIAL_ITEMS)
  const [completedCount, setCompletedCount] = useState(0)
  const [isResetting, setIsResetting] = useState(false)
  
  const lastEntryTime = useRef(0)
  const nextId = useRef(0)

  const reset = useCallback(() => {
    setItems([])
    setInputCount(INITIAL_ITEMS)
    setCompletedCount(0)
    setIsResetting(false)
    lastEntryTime.current = 0
    nextId.current = 0
  }, [])

  useEffect(() => {
    if (isResetting) return

    const tickRate = 100
    const interval = setInterval(() => {
      const now = Date.now()
      
      setItems(prevItems => {
        let nextItems = [...prevItems]
        let newItems: PipelineItem[] = []
        let hasChanges = false

        // 1. AUTO-RESET TRIGGER
        if (completedCount >= INITIAL_ITEMS && !isResetting) {
           setIsResetting(true)
           setTimeout(reset, 2000)
           return prevItems
        }

        // 2. ENTRY
        if (inputCount > 0 && now - lastEntryTime.current > ENTRY_INTERVAL) {
           const inPreprocess = prevItems.some(i => i.stage === 'preprocess')
           if (!inPreprocess && nextId.current < INITIAL_ITEMS) {
              const id = nextId.current++
              newItems.push({
                id: String(id),
                originalId: id,
                type: 'main',
                stage: 'preprocess',
                enteredStageAt: now,
              })
              lastEntryTime.current = now
              setInputCount(c => c - 1)
              hasChanges = true
           }
        }

        // 3. TRANSITIONS
        const processedItems: PipelineItem[] = []
        for (const item of prevItems) {
            let nextItem = item
            
            if (item.stage === 'preprocess' && now - item.enteredStageAt > PREPROCESS_DURATION) {
                 hasChanges = true
                 nextItem = {
                    ...item,
                    id: `${item.originalId}-infer`,
                    type: 'inference',
                    stage: 'inference-queue',
                    enteredStageAt: now
                 }
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
                 const queue = prevItems.filter(i => i.stage === 'inference-queue').sort((a,b) => a.enteredStageAt - b.enteredStageAt)
                 if (activeWorkers === 0 && queue[0]?.id === item.id) {
                    hasChanges = true
                    nextItem = { ...item, stage: 'inference-process', enteredStageAt: now }
                 }
            }
            else if (item.stage === 'inference-process' && now - item.enteredStageAt > INFERENCE_DURATION) {
                 hasChanges = true
                 nextItem = { ...item, stage: 'done', enteredStageAt: now }
                 setCompletedCount(c => c + 0.5)
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
  }, [inputCount, completedCount, isResetting, reset])

  return { items, inputCount, completedCount: Math.floor(completedCount), isResetting }
}
