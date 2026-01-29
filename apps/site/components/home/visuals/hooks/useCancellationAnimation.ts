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

export type QueueSlot = QueuedItem | null

export interface InFlightItem {
  id: string
  shape: Shape
  edges: number
}

interface TickState {
  queue: QueueSlot[] // ordered array, index = slot position
  inFlight: InFlightItem | null
  cancelingIds: Set<string>
  cancelingUntil: number | null
  postCancelPauseUntil: number | null
  workerBusyUntil: number
  commandPhase: CommandPhase
  commandIndex: number
  commandNextAt: number
  nextCommandAt: number
}

export interface UseCancellationAnimationReturn {
  queue: QueueSlot[]
  inFlight: InFlightItem | null
  cancelingIds: Set<string>
  commandText: string
  commandPhase: CommandPhase
}

export type CommandPhase = 'idle' | 'typing' | 'executing'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const COMMAND_TEXT = 'cancel(edges > 3)'
const TYPE_INTERVAL_MS = 60
const EXECUTE_PAUSE_MS = 1000
export const CANCEL_ANIMATION_MS = 700
const POST_CANCEL_PAUSE_MS = 500
const MAX_QUEUE_SIZE = 4

// Queue slot x positions (fixed)
// Index 0 = front of queue (closest to worker), Index 3 = back (furthest)
// Items move RIGHT toward worker as they advance
export const QUEUE_SLOTS = [128, 96, 64, 32] // front → back
export const WORKER_X = 224

// Timing ranges (ms)
const COMMAND_INTERVAL: [number, number] = [2000, 6000]
const PROCESS_TIME: [number, number] = [1500, 2500]

// Shape spawn weights
const SPAWN_WEIGHTS: Record<Shape, number> = {
  circle: 1,
  triangle: 1,
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
// Tick function
// -----------------------------------------------------------------------------

interface TickParams {
  state: TickState
  now: number
}

function tick({ state, now }: TickParams): TickState {
  let {
    queue,
    inFlight,
    cancelingIds,
    cancelingUntil,
    postCancelPauseUntil,
    workerBusyUntil,
    commandPhase,
    commandIndex,
    commandNextAt,
    nextCommandAt,
  } = state
  let didChange = false
  let queueCloned = false
  let cancelingCloned = false

  const ensureQueue = () => {
    if (!queueCloned) {
      queue = [...queue]
      queueCloned = true
      didChange = true
    }
  }

  const isCanceling = () => cancelingUntil !== null && now < cancelingUntil
  const isPostCancelPaused = () =>
    postCancelPauseUntil !== null && now < postCancelPauseUntil
  const isQueuePaused = () => isCanceling() || isPostCancelPaused()

  const ensureCanceling = () => {
    if (!cancelingCloned) {
      cancelingIds = new Set(cancelingIds)
      cancelingCloned = true
      didChange = true
    }
  }

  if (postCancelPauseUntil && now >= postCancelPauseUntil) {
    postCancelPauseUntil = null
    didChange = true
  }

  if (commandPhase === 'idle' && now >= nextCommandAt && !isQueuePaused()) {
    commandPhase = 'typing'
    commandIndex = 0
    commandNextAt = now + TYPE_INTERVAL_MS
    didChange = true
  }

  if (commandPhase === 'typing' && now >= commandNextAt) {
    commandIndex = Math.min(COMMAND_TEXT.length, commandIndex + 1)
    commandNextAt = now + TYPE_INTERVAL_MS
    didChange = true

    if (commandIndex >= COMMAND_TEXT.length) {
      commandPhase = 'executing'
      commandNextAt = now + EXECUTE_PAUSE_MS
      didChange = true
    }
  }

  if (commandPhase === 'executing' && now >= commandNextAt) {
    if (!cancelingUntil) {
      const nextCanceling = new Set<string>()
      for (const slot of queue) {
        if (slot && slot.edges > 3) {
          nextCanceling.add(slot.id)
        }
      }
      if (inFlight && inFlight.edges > 3) {
        nextCanceling.add(inFlight.id)
      }

      if (nextCanceling.size > 0) {
        ensureCanceling()
        cancelingIds = nextCanceling
        cancelingUntil = now + CANCEL_ANIMATION_MS
        commandNextAt = cancelingUntil
        didChange = true
      } else {
        commandPhase = 'idle'
        commandIndex = 0
        nextCommandAt = now + randomRange(...COMMAND_INTERVAL)
        didChange = true
      }
    } else {
      if (cancelingIds.size > 0) {
        ensureQueue()
        for (let i = 0; i < queue.length; i++) {
          const slot = queue[i]
          if (slot && cancelingIds.has(slot.id)) {
            queue[i] = null
            didChange = true
          }
        }
        if (inFlight && cancelingIds.has(inFlight.id)) {
          inFlight = null
          didChange = true
        }
        ensureCanceling()
        cancelingIds.clear()
      }
      cancelingUntil = null
      postCancelPauseUntil = now + POST_CANCEL_PAUSE_MS
      commandPhase = 'idle'
      commandIndex = 0
      nextCommandAt = now + randomRange(...COMMAND_INTERVAL)
      didChange = true
    }
  }

  if (!isQueuePaused() && inFlight && now >= workerBusyUntil) {
    inFlight = null
    didChange = true
  }

  if (!isQueuePaused()) {
    const hasHoles = queue.some(slot => slot === null) && queue.some(slot => slot !== null)
    if (hasHoles) {
      ensureQueue()
      const compacted: QueueSlot[] = Array(MAX_QUEUE_SIZE).fill(null)
      let nextIndex = 0
      for (const slot of queue) {
        if (!slot) continue
        compacted[nextIndex] = slot
        nextIndex += 1
      }
      queue = compacted
      didChange = true
    }

    if (!inFlight) {
      const promoteIndex = queue.findIndex(slot => slot !== null)
      if (promoteIndex >= 0) {
        const promoted = queue[promoteIndex]
        if (promoted) {
          ensureQueue()
          queue[promoteIndex] = null
          inFlight = { ...promoted }
          workerBusyUntil = now + randomRange(...PROCESS_TIME)
          didChange = true
        }
      }
    }

    let filled = false
    for (let i = MAX_QUEUE_SIZE - 1; i >= 0; i--) {
      if (queue[i] === null) {
        ensureQueue()
        queue[i] = createItem()
        filled = true
        didChange = true
      }
    }
    if (filled) {
      // Preserve queue reference updates.
    }
  }

  if (!didChange) {
    return state
  }

  return {
    queue,
    inFlight,
    cancelingIds,
    cancelingUntil,
    postCancelPauseUntil,
    workerBusyUntil,
    commandPhase,
    commandIndex,
    commandNextAt,
    nextCommandAt,
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

  // And items in queue (full capacity)
  const queue: QueuedItem[] = []
  for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
    queue.push(createItem())
  }

  return {
    queue,
    inFlight,
    cancelingIds: new Set(),
    cancelingUntil: null,
    postCancelPauseUntil: null,
    workerBusyUntil: now + randomRange(...PROCESS_TIME),
    commandPhase: 'idle',
    commandIndex: 0,
    commandNextAt: now + TYPE_INTERVAL_MS,
    nextCommandAt: now + 2000,
  }
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export function useCancellationAnimation(): UseCancellationAnimationReturn {
  const [state, setState] = useState<TickState>(createInitialState)
  const stateRef = useRef(state)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPausedRef = useRef(false)

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const step = useCallback((now: number) => {
    const next = tick({ state: stateRef.current, now })
    if (next !== stateRef.current) {
      stateRef.current = next
      setState(next)
    }
    return next
  }, [])

  const scheduleNext = useCallback(
    (now: number, nextState: TickState) => {
      if (isPausedRef.current) return
      clearTimeoutRef()

      const times: number[] = []
      if (nextState.inFlight) {
        times.push(nextState.workerBusyUntil)
      }
      if (nextState.postCancelPauseUntil) {
        times.push(nextState.postCancelPauseUntil)
      }
      if (nextState.commandPhase === 'typing' || nextState.commandPhase === 'executing') {
        times.push(nextState.commandNextAt)
      } else {
        times.push(nextState.nextCommandAt)
      }

      const future = times.filter(time => time > now)
      if (future.length === 0) return
      const nextAt = Math.min(...future)
      const delay = Math.max(16, nextAt - now)
      timeoutRef.current = setTimeout(() => {
        if (isPausedRef.current) return
        const tickNow = Date.now()
        const latest = step(tickNow)
        scheduleNext(tickNow, latest)
      }, delay)
    },
    [clearTimeoutRef, step]
  )

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        isPausedRef.current = true
        clearTimeoutRef()
        return
      }
      isPausedRef.current = false
      const now = Date.now()
      const latest = step(now)
      scheduleNext(now, latest)
    }

    document.addEventListener('visibilitychange', handleVisibility)
    scheduleNext(Date.now(), stateRef.current)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      clearTimeoutRef()
    }
  }, [clearTimeoutRef, scheduleNext, step])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const commandText =
    state.commandPhase === 'typing'
      ? COMMAND_TEXT.slice(0, state.commandIndex)
      : state.commandPhase === 'executing'
        ? COMMAND_TEXT
        : ''

  return {
    queue: state.queue,
    inFlight: state.inFlight,
    cancelingIds: state.cancelingIds,
    commandText,
    commandPhase: state.commandPhase,
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
