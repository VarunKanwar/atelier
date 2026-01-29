import { animate, type MotionValue, useMotionValue } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type Shape = 'circle' | 'triangle' | 'square' | 'diamond' | 'pentagon' | 'hexagon'

export const SHAPE_EDGES: Record<Shape, number> = {
  circle: 0,
  triangle: 3,
  square: 4,
  diamond: 4,
  pentagon: 5,
  hexagon: 6,
}

export interface QueuedItem {
  id: string
  shape: Shape
  edges: number
}

export interface InFlightItem {
  id: string
  shape: Shape
  edges: number
}

interface TickState {
  queue: QueuedItem[] // ordered array, index = slot position
  inFlight: InFlightItem | null
  exitingIds: Set<string> // items currently fading out
  waveActive: boolean
  showLabel: boolean
  workerBusyUntil: number
  nextSpawnAt: number
  nextWaveAt: number
}

export interface UseCancellationAnimationReturn {
  queue: QueuedItem[]
  inFlight: InFlightItem | null
  exitingIds: Set<string>
  waveX: MotionValue<number>
  waveActive: boolean
  showLabel: boolean
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const TICK_MS = 30
const VIEWBOX_WIDTH = 320
const WAVE_DURATION_MS = 4000 // 2 seconds for wave to cross
const MAX_QUEUE_SIZE = 4

// Queue slot x positions (fixed)
// Index 0 = front of queue (closest to worker), Index 3 = back (furthest)
// Items move RIGHT toward worker as they advance
export const QUEUE_SLOTS = [128, 96, 64, 32] // front → back
export const WORKER_X = 224

// Timing ranges (ms)
const SPAWN_INTERVAL: [number, number] = [800, 1400]
const WAVE_INTERVAL: [number, number] = [4000, 6000]
const PROCESS_TIME: [number, number] = [1500, 2500]

// Shape spawn weights
const SPAWN_WEIGHTS: Record<Shape, number> = {
  circle: 2,
  triangle: 2,
  square: 1,
  diamond: 1,
  pentagon: 1,
  hexagon: 1,
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function randomRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

let lastSpawnedShape: Shape | null = null

function randomShape(): Shape {
  // Filter out the last spawned shape to avoid repeats
  const entries = (Object.entries(SPAWN_WEIGHTS) as [Shape, number][]).filter(
    ([shape]) => shape !== lastSpawnedShape
  )
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0)
  let random = Math.random() * totalWeight

  for (const [shape, weight] of entries) {
    random -= weight
    if (random <= 0) {
      lastSpawnedShape = shape
      return shape
    }
  }
  const fallback = entries[0]?.[0] ?? 'circle'
  lastSpawnedShape = fallback
  return fallback
}

let idCounter = 0
function nextId(): string {
  return `item-${++idCounter}`
}

function createItem(): QueuedItem {
  const shape = randomShape()
  return {
    id: nextId(),
    shape,
    edges: SHAPE_EDGES[shape],
  }
}

// -----------------------------------------------------------------------------
// Tick function (waveX is read from motion value, not managed here)
// -----------------------------------------------------------------------------

interface TickParams {
  state: TickState
  now: number
  waveX: number // current value from motion value
  onStartWave: () => void // callback to start wave animation
}

function tick({ state, now, waveX, onStartWave }: TickParams): TickState {
  let {
    queue,
    inFlight,
    exitingIds,
    waveActive,
    showLabel,
    workerBusyUntil,
    nextSpawnAt,
    nextWaveAt,
  } = state

  // Clone mutable collections
  queue = [...queue]
  exitingIds = new Set(exitingIds)

  // Clear old exiting items (they've had time to animate out)
  if (exitingIds.size > 0 && !waveActive) {
    exitingIds.clear()
  }

  // Wave logic - check cancellations based on current waveX
  if (waveActive) {
    // Check queue items against wave position (left to right)
    const survivingQueue: QueuedItem[] = []
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      const slotX = QUEUE_SLOTS[i]

      if (waveX >= slotX && item.edges > 3 && !exitingIds.has(item.id)) {
        // Cancel this item
        exitingIds.add(item.id)
      } else if (!exitingIds.has(item.id)) {
        survivingQueue.push(item)
      }
    }
    queue = survivingQueue

    // Check in-flight item
    if (inFlight && waveX >= WORKER_X && inFlight.edges > 3 && !exitingIds.has(inFlight.id)) {
      exitingIds.add(inFlight.id)
      inFlight = null
      // Immediately promote front of queue if available
      const promoted = queue.shift()
      if (promoted) {
        inFlight = { ...promoted }
        workerBusyUntil = now + randomRange(...PROCESS_TIME)
      }
    }

    // Wave complete
    if (waveX >= VIEWBOX_WIDTH) {
      waveActive = false
      showLabel = false
    }
  }

  // Promotion: if worker empty and not during wave, promote front item
  if (!inFlight && !waveActive && queue.length > 0 && now >= workerBusyUntil) {
    const promoted = queue.shift()
    if (promoted) {
      inFlight = { ...promoted }
      workerBusyUntil = now + randomRange(...PROCESS_TIME)
    }
  }

  // Worker completion: item exits, becomes available for next
  if (inFlight && now >= workerBusyUntil && !waveActive) {
    exitingIds.add(inFlight.id)
    inFlight = null
  }

  // Spawning: add items to back of queue
  if (queue.length < MAX_QUEUE_SIZE && now >= nextSpawnAt && !waveActive) {
    queue.push(createItem())
    nextSpawnAt = now + randomRange(...SPAWN_INTERVAL)
  }

  // Trigger wave
  if (!waveActive && now >= nextWaveAt) {
    waveActive = true
    showLabel = true
    onStartWave() // Start the Framer Motion animation
    nextWaveAt = now + randomRange(...WAVE_INTERVAL)
  }

  return {
    queue,
    inFlight,
    exitingIds,
    waveActive,
    showLabel,
    workerBusyUntil,
    nextSpawnAt,
    nextWaveAt,
  }
}

// -----------------------------------------------------------------------------
// Initial state
// -----------------------------------------------------------------------------

function createInitialState(): TickState {
  const now = Date.now()

  // Start with one item in-flight
  const inFlightShape = randomShape()
  const inFlight: InFlightItem = {
    id: nextId(),
    shape: inFlightShape,
    edges: SHAPE_EDGES[inFlightShape],
  }

  // And 3 items in queue
  const queue: QueuedItem[] = []
  for (let i = 0; i < 3; i++) {
    queue.push(createItem())
  }

  return {
    queue,
    inFlight,
    exitingIds: new Set(),
    waveActive: false,
    showLabel: false,
    workerBusyUntil: now + randomRange(...PROCESS_TIME),
    nextSpawnAt: now + randomRange(...SPAWN_INTERVAL),
    nextWaveAt: now + 2500, // first wave after 2.5s
  }
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export function useCancellationAnimation(): UseCancellationAnimationReturn {
  const [state, setState] = useState<TickState>(createInitialState)
  const waveX = useMotionValue(-10)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPausedRef = useRef(false)
  const animationRef = useRef<ReturnType<typeof animate> | null>(null)

  const startWave = useCallback(() => {
    // Cancel any existing animation
    if (animationRef.current) {
      animationRef.current.stop()
    }
    // Start smooth animation from 0 to past viewbox
    waveX.set(0)
    animationRef.current = animate(waveX, VIEWBOX_WIDTH + 20, {
      duration: WAVE_DURATION_MS / 1000,
      ease: 'linear',
    })
  }, [waveX])

  const startInterval = useCallback(() => {
    if (intervalRef.current) return
    intervalRef.current = setInterval(() => {
      if (!isPausedRef.current) {
        setState(prev =>
          tick({
            state: prev,
            now: Date.now(),
            waveX: waveX.get(),
            onStartWave: startWave,
          })
        )
      }
    }, TICK_MS)
  }, [waveX, startWave])

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        isPausedRef.current = true
        // Pause wave animation
        if (animationRef.current) {
          animationRef.current.stop()
        }
      } else {
        isPausedRef.current = false
        // Adjust timestamps on resume
        setState(prev => {
          const now = Date.now()
          return {
            ...prev,
            waveActive: false, // Reset wave state on resume
            showLabel: false,
            workerBusyUntil: Math.max(prev.workerBusyUntil, now + 500),
            nextSpawnAt: Math.max(prev.nextSpawnAt, now + 300),
            nextWaveAt: Math.max(prev.nextWaveAt, now + 2000),
          }
        })
        waveX.set(-10)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    startInterval()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      stopInterval()
      if (animationRef.current) {
        animationRef.current.stop()
      }
    }
  }, [startInterval, stopInterval, waveX])

  return {
    queue: state.queue,
    inFlight: state.inFlight,
    exitingIds: state.exitingIds,
    waveX,
    waveActive: state.waveActive,
    showLabel: state.showLabel,
  }
}

// -----------------------------------------------------------------------------
// Static data for reduced motion (component creates the motion value)
// -----------------------------------------------------------------------------

export const STATIC_QUEUE: QueuedItem[] = [
  { id: 'static-1', shape: 'circle', edges: 0 },
  { id: 'static-2', shape: 'triangle', edges: 3 },
  { id: 'static-3', shape: 'square', edges: 4 },
]

export const STATIC_IN_FLIGHT: InFlightItem = { id: 'static-4', shape: 'pentagon', edges: 5 }
