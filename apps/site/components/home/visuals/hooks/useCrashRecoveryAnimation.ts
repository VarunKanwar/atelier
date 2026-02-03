import { useCallback, useEffect, useRef, useState } from 'react'
import { QUEUE_SLOTS } from '../common/queueLayout'

export type CrashShape = 'circle' | 'square'

export interface CrashItem {
  id: string
  shape: CrashShape
  isFaulty: boolean
  attempts: number
  entryFromWorker?: number
}

export type QueueSlot = CrashItem | null

export interface WorkerSlot {
  item: CrashItem | null
  durationMs: number | null
  busyUntil: number
  cooldownUntil: number
  startedAt: number
  frozenProgress: number | null
}

export interface DeadLetterItem {
  id: string
  attempts: number
  appearedAt: number
  clearAt: number
  fromWorkerId: number
}

interface TickState {
  queue: QueueSlot[]
  workers: WorkerSlot[]
  deadLetter: DeadLetterItem | null
  failingWorkerId: number | null
  failingUntil: number | null
  requeueItem: CrashItem | null
  requeueAt: number | null
  collapseNextAt: number | null
  spawnNextAt: number | null
  nextWorkerIndex: number
  nextFaultySpawnAt: number
}

export interface UseCrashRecoveryAnimationReturn {
  queue: QueueSlot[]
  workers: WorkerSlot[]
  deadLetter: DeadLetterItem | null
  failingWorkerId: number | null
}

const MAX_QUEUE_SIZE = QUEUE_SLOTS.length
const WORKER_COUNT = 3

const MAX_ATTEMPTS = 3
const PROCESS_TIME: [number, number] = [1500, 2500]
const FAULTY_FAIL_TIME: [number, number] = [700, 1100]
const FAULTY_FILL_TIME: [number, number] = [1400, 1800]
export const FAILURE_ANIMATION_MS = 420
const REQUEUE_DELAY_MS = 160
const REQUEUE_RETRY_MS = 120
const WORKER_RECOVERY_PAUSE_MS = 220
const DEAD_LETTER_DISPLAY_MS = 2200
const QUEUE_SHIFT_DELAY_MS = 100
const QUEUE_SPAWN_DELAY_MS = 110
const FAULTY_RESPAWN_DELAY_MS = 700

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function randomRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

let idCounter = 0
function nextId(): string {
  return `crash-item-${++idCounter}`
}

function createItem(isFaulty: boolean): CrashItem {
  return {
    id: nextId(),
    shape: isFaulty ? 'square' : 'circle',
    isFaulty,
    attempts: 0,
  }
}

function createEmptyWorker(cooldownUntil = 0): WorkerSlot {
  return {
    item: null,
    durationMs: null,
    busyUntil: 0,
    cooldownUntil,
    startedAt: 0,
    frozenProgress: null,
  }
}

function createWorker(item: CrashItem | null, now: number): WorkerSlot {
  if (!item) return createEmptyWorker()
  if (item.isFaulty) {
    const durationMs = randomRange(...FAULTY_FILL_TIME)
    const busyUntil = now + randomRange(...FAULTY_FAIL_TIME)
    return {
      item,
      durationMs,
      busyUntil,
      cooldownUntil: 0,
      startedAt: now,
      frozenProgress: null,
    }
  }
  const durationMs = randomRange(...PROCESS_TIME)
  return {
    item,
    durationMs,
    busyUntil: now + durationMs,
    cooldownUntil: 0,
    startedAt: now,
    frozenProgress: null,
  }
}

function hasGap(queue: QueueSlot[]): boolean {
  for (let i = 0; i < queue.length - 1; i++) {
    if (queue[i] === null && queue[i + 1] !== null) return true
  }
  return false
}

function compactQueue(queue: QueueSlot[]): QueueSlot[] {
  const compacted: QueueSlot[] = Array(MAX_QUEUE_SIZE).fill(null)
  let nextIndex = 0
  for (const slot of queue) {
    if (!slot) continue
    compacted[nextIndex] = slot
    nextIndex += 1
  }
  return compacted
}

function hasFaulty(
  queue: QueueSlot[],
  workers: WorkerSlot[],
  requeueItem: CrashItem | null,
  deadLetter: DeadLetterItem | null
): boolean {
  if (deadLetter) return true
  if (requeueItem?.isFaulty) return true
  if (queue.some(item => item?.isFaulty)) return true
  return workers.some(worker => worker.item?.isFaulty)
}

function findAvailableWorker(
  workers: WorkerSlot[],
  startIndex: number,
  now: number
): number | null {
  for (let i = 0; i < WORKER_COUNT; i++) {
    const index = (startIndex + i) % WORKER_COUNT
    if (!workers[index].item && now >= workers[index].cooldownUntil) return index
  }
  return null
}

// -----------------------------------------------------------------------------
// Initial state
// -----------------------------------------------------------------------------

function createInitialState(): TickState {
  const now = Date.now()
  const queue: QueueSlot[] = Array(MAX_QUEUE_SIZE).fill(null)

  for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
    queue[i] = createItem(false)
  }

  const faultyIndex = Math.min(2, MAX_QUEUE_SIZE - 1)
  queue[faultyIndex] = createItem(true)

  const workers: WorkerSlot[] = [
    createWorker(createItem(false), now),
    createWorker(createItem(false), now),
    createEmptyWorker(),
  ]

  return {
    queue,
    workers,
    deadLetter: null,
    failingWorkerId: null,
    failingUntil: null,
    requeueItem: null,
    requeueAt: null,
    collapseNextAt: null,
    spawnNextAt: null,
    nextWorkerIndex: 0,
    nextFaultySpawnAt: now + FAULTY_RESPAWN_DELAY_MS,
  }
}

// -----------------------------------------------------------------------------
// Tick
// -----------------------------------------------------------------------------

interface TickParams {
  state: TickState
  now: number
}

function tick({ state, now }: TickParams): TickState {
  let {
    queue,
    workers,
    deadLetter,
    failingWorkerId,
    failingUntil,
    requeueItem,
    requeueAt,
    collapseNextAt,
    spawnNextAt,
    nextWorkerIndex,
    nextFaultySpawnAt,
  } = state

  let didChange = false
  let queueCloned = false
  let workersCloned = false

  const ensureQueue = () => {
    if (!queueCloned) {
      queue = [...queue]
      queueCloned = true
      didChange = true
    }
  }

  const ensureWorkers = () => {
    if (!workersCloned) {
      workers = workers.map(worker => ({
        ...worker,
        item: worker.item ? { ...worker.item } : null,
      }))
      workersCloned = true
      didChange = true
    }
  }

  const setWorker = (index: number, next: WorkerSlot) => {
    ensureWorkers()
    workers[index] = next
  }

  if (deadLetter && now >= deadLetter.clearAt) {
    deadLetter = null
    nextFaultySpawnAt = now + FAULTY_RESPAWN_DELAY_MS
    didChange = true
  }

  if (failingUntil !== null && now >= failingUntil && failingWorkerId !== null) {
    const worker = workers[failingWorkerId]
    if (worker?.item) {
      const nextItem = {
        ...worker.item,
        attempts: worker.item.attempts + 1,
        entryFromWorker: failingWorkerId,
      }
      if (nextItem.attempts >= MAX_ATTEMPTS) {
        deadLetter = {
          id: nextItem.id,
          attempts: nextItem.attempts,
          appearedAt: now,
          clearAt: now + DEAD_LETTER_DISPLAY_MS,
          fromWorkerId: failingWorkerId,
        }
      } else {
        requeueItem = nextItem
        requeueAt = now + REQUEUE_DELAY_MS
      }
      didChange = true
    }
    setWorker(failingWorkerId, createEmptyWorker(now + WORKER_RECOVERY_PAUSE_MS))
    failingWorkerId = null
    failingUntil = null
    didChange = true
  }

  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = workers[i]
    if (!worker.item) continue
    if (worker.item.isFaulty) {
      if (failingWorkerId === null && now >= worker.busyUntil) {
        failingWorkerId = i
        failingUntil = now + FAILURE_ANIMATION_MS
        const progress =
          worker.durationMs && worker.durationMs > 0
            ? Math.min(1, Math.max(0, (now - worker.startedAt) / worker.durationMs))
            : 0
        ensureWorkers()
        workers[i] = { ...worker, frozenProgress: progress }
        didChange = true
      }
    } else if (now >= worker.busyUntil) {
      setWorker(i, createEmptyWorker())
      didChange = true
    }
  }

  if (requeueItem && requeueAt !== null && now >= requeueAt) {
    const hasSpace = queue.some(slot => slot === null)
    if (hasSpace) {
      queue = compactQueue(queue)
      queueCloned = true
      didChange = true
      const insertIndex = MAX_QUEUE_SIZE - 1
      if (!queue[insertIndex]) {
        queue[insertIndex] = requeueItem
        requeueItem = null
        requeueAt = null
        didChange = true
      } else {
        requeueAt = now + REQUEUE_RETRY_MS
        didChange = true
      }
    } else {
      requeueAt = now + REQUEUE_RETRY_MS
      didChange = true
    }
  }

  let gap = hasGap(queue)

  if (collapseNextAt !== null && now >= collapseNextAt) {
    if (gap) {
      queue = compactQueue(queue)
      queueCloned = true
      didChange = true
    }
    collapseNextAt = null
    didChange = true
  } else if (collapseNextAt === null && gap) {
    collapseNextAt = now + QUEUE_SHIFT_DELAY_MS
    didChange = true
  }

  gap = hasGap(queue)

  const faultyActive = hasFaulty(queue, workers, requeueItem, deadLetter)
  const shouldSpawnFaulty = !faultyActive && now >= nextFaultySpawnAt
  const lastSlotIndex = MAX_QUEUE_SIZE - 1
  const canSpawn = !requeueItem && !gap && queue[lastSlotIndex] === null

  if (canSpawn) {
    if (spawnNextAt === null) {
      spawnNextAt = now + QUEUE_SPAWN_DELAY_MS
      didChange = true
    } else if (now >= spawnNextAt) {
      ensureQueue()
      queue[lastSlotIndex] = createItem(shouldSpawnFaulty)
      spawnNextAt = null
      if (shouldSpawnFaulty) {
        nextFaultySpawnAt = now + FAULTY_RESPAWN_DELAY_MS
      }
      didChange = true
    }
  } else if (spawnNextAt !== null) {
    spawnNextAt = null
    didChange = true
  }

  const promoteFront = () => {
    const workerIndex = findAvailableWorker(workers, nextWorkerIndex, now)
    if (workerIndex === null) return
    const front = queue[0]
    if (!front) return
    ensureQueue()
    ensureWorkers()
    queue[0] = null
    workers[workerIndex] = createWorker({ ...front }, now)
    nextWorkerIndex = (workerIndex + 1) % WORKER_COUNT
    didChange = true
  }

  promoteFront()

  if (collapseNextAt === null && hasGap(queue)) {
    collapseNextAt = now + QUEUE_SHIFT_DELAY_MS
    didChange = true
  }

  if (!didChange) return state

  return {
    queue,
    workers,
    deadLetter,
    failingWorkerId,
    failingUntil,
    requeueItem,
    requeueAt,
    collapseNextAt,
    spawnNextAt,
    nextWorkerIndex,
    nextFaultySpawnAt,
  }
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

interface UseCrashRecoveryAnimationOptions {
  enabled?: boolean
}

export function useCrashRecoveryAnimation(
  options: UseCrashRecoveryAnimationOptions = {}
): UseCrashRecoveryAnimationReturn {
  const enabled = options.enabled ?? true
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

      for (const worker of nextState.workers) {
        if (worker.item) times.push(worker.busyUntil)
        if (!worker.item && worker.cooldownUntil > now) {
          times.push(worker.cooldownUntil)
        }
      }
      if (nextState.failingUntil) times.push(nextState.failingUntil)
      if (nextState.requeueAt) times.push(nextState.requeueAt)
      if (nextState.collapseNextAt) times.push(nextState.collapseNextAt)
      if (nextState.spawnNextAt) times.push(nextState.spawnNextAt)
      if (nextState.deadLetter) times.push(nextState.deadLetter.clearAt)
      if (nextState.nextFaultySpawnAt) times.push(nextState.nextFaultySpawnAt)

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
    if (!enabled) {
      isPausedRef.current = true
      clearTimeoutRef()
      return
    }

    isPausedRef.current = false

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
  }, [clearTimeoutRef, enabled, scheduleNext, step])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  return {
    queue: state.queue,
    workers: state.workers,
    deadLetter: state.deadLetter,
    failingWorkerId: state.failingWorkerId,
  }
}

// -----------------------------------------------------------------------------
// Static data for reduced motion
// -----------------------------------------------------------------------------

export const STATIC_STATE: UseCrashRecoveryAnimationReturn = {
  queue: [
    { id: 'static-1', shape: 'circle', isFaulty: false, attempts: 0 },
    { id: 'static-2', shape: 'circle', isFaulty: false, attempts: 0 },
    { id: 'static-3', shape: 'square', isFaulty: true, attempts: 0 },
    { id: 'static-4', shape: 'circle', isFaulty: false, attempts: 0 },
  ],
  workers: [
    {
      item: { id: 'static-5', shape: 'circle', isFaulty: false, attempts: 0 },
      durationMs: null,
      busyUntil: 0,
      cooldownUntil: 0,
      startedAt: 0,
      frozenProgress: null,
    },
    {
      item: { id: 'static-6', shape: 'circle', isFaulty: false, attempts: 0 },
      durationMs: null,
      busyUntil: 0,
      cooldownUntil: 0,
      startedAt: 0,
      frozenProgress: null,
    },
    {
      item: null,
      durationMs: null,
      busyUntil: 0,
      cooldownUntil: 0,
      startedAt: 0,
      frozenProgress: null,
    },
  ],
  deadLetter: null,
  failingWorkerId: null,
}
