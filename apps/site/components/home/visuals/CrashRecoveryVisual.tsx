import { Box } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import {
  QUEUE_ENTRY_X,
  QUEUE_MOVE_MS,
  QUEUE_SLOTS,
  WORKER_BOX_SIZE,
  WORKER_X,
} from './common/queueLayout'
import {
  FAILURE_ANIMATION_MS,
  STATIC_STATE,
  type CrashItem,
  type WorkerSlot,
  useCrashRecoveryAnimation,
} from './hooks/useCrashRecoveryAnimation'

const VIEWBOX = { width: 320, height: 160 }
const SHAPE_SIZE = 6
const QUEUE_MOVE_S = QUEUE_MOVE_MS / 1000
const FAILURE_ANIMATION_S = FAILURE_ANIMATION_MS / 1000

const WORKER_GAP = 14
const WORKER_STACK_HEIGHT = WORKER_BOX_SIZE.height * 3 + WORKER_GAP * 2
const WORKER_TOP_CENTER = (VIEWBOX.height - WORKER_STACK_HEIGHT) / 2 + WORKER_BOX_SIZE.height / 2
const WORKER_Y_POSITIONS = [
  WORKER_TOP_CENTER,
  WORKER_TOP_CENTER + WORKER_BOX_SIZE.height + WORKER_GAP,
  WORKER_TOP_CENTER + (WORKER_BOX_SIZE.height + WORKER_GAP) * 2,
]

const QUEUE_CENTER_Y = WORKER_Y_POSITIONS[1]

const COLORS = {
  stroke: 'var(--stroke-subtle)',
  strokeMuted: 'var(--stroke-muted)',
  textMuted: 'var(--text-muted)',
  strokeFail: '#f97316',
} as const

const FRAGMENT_SIZE = SHAPE_SIZE * 0.7
const FRAGMENTS = [
  { dx: -10, dy: -6, rotate: -35, delay: 0 },
  { dx: 8, dy: -8, rotate: 28, delay: 0.04 },
  { dx: -6, dy: 9, rotate: -18, delay: 0.06 },
  { dx: 10, dy: 6, rotate: 22, delay: 0.08 },
] as const

function FragmentScatter({ stroke }: { stroke: string }) {
  return (
    <g>
      {FRAGMENTS.map((fragment, index) => (
        <motion.g
          // biome-ignore lint/suspicious/noArrayIndexKey: static fragment array, never reordered
          key={index}
          initial={{ x: 0, y: 0, opacity: 0.9, scale: 1, rotate: 0 }}
          animate={{
            x: fragment.dx,
            y: fragment.dy,
            opacity: 0,
            scale: 0.25,
            rotate: fragment.rotate,
          }}
          transition={{
            duration: FAILURE_ANIMATION_S,
            ease: 'easeOut',
            delay: fragment.delay,
          }}
        >
          <rect
            x={-FRAGMENT_SIZE / 2}
            y={-FRAGMENT_SIZE / 2}
            width={FRAGMENT_SIZE}
            height={FRAGMENT_SIZE}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            rx={1}
            ry={1}
          />
        </motion.g>
      ))}
    </g>
  )
}

function ShapeRenderer({ item }: { item: CrashItem }) {
  const strokeWidth = 1
  if (item.shape === 'circle') {
    return (
      <circle r={SHAPE_SIZE * 0.8} fill="none" stroke={COLORS.stroke} strokeWidth={strokeWidth} />
    )
  }

  const size = SHAPE_SIZE * 1.4
  const badgeX = 0
  const badgeY = 0
  const badgeScale = 0.4
  const attempts = Math.min(9, Math.max(0, item.attempts))
  const retryLabel = `↻${attempts}`

  return (
    <g>
      <rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        fill="none"
        stroke={COLORS.stroke}
        strokeWidth={strokeWidth}
      />
      {attempts > 0 ? (
        <g transform={`translate(${badgeX}, ${badgeY}) scale(${badgeScale})`}>
          <text
            x={0}
            y={0}
            fontSize={6}
            fontFamily="var(--font-mono)"
            fill={COLORS.textMuted}
            opacity={0.7}
            dominantBaseline="middle"
            textAnchor="middle"
          >
            {retryLabel}
          </text>
        </g>
      ) : null}
    </g>
  )
}

function ShapeFill({ item, durationMs }: { item: CrashItem; durationMs: number | null }) {
  if (!durationMs) {
    return <ShapeRenderer item={item} />
  }

  const fillId = `crash-fill-${item.id}`
  const fillTransition = { duration: durationMs / 1000, ease: 'linear' as const }

  return (
    <g>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          <stop offset={0} stopColor={COLORS.stroke} />
          <motion.stop
            initial={{ offset: 0 }}
            animate={{ offset: 1 }}
            transition={fillTransition}
            stopColor={COLORS.stroke}
          />
          <motion.stop
            initial={{ offset: 0 }}
            animate={{ offset: 1 }}
            transition={fillTransition}
            stopColor="transparent"
          />
          <stop offset={1} stopColor="transparent" />
        </linearGradient>
      </defs>
      {item.shape === 'circle' ? (
        <circle r={SHAPE_SIZE * 0.8} fill={`url(#${fillId})`} stroke="none" />
      ) : (
        <rect
          x={-SHAPE_SIZE * 0.7}
          y={-SHAPE_SIZE * 0.7}
          width={SHAPE_SIZE * 1.4}
          height={SHAPE_SIZE * 1.4}
          fill={`url(#${fillId})`}
          stroke="none"
        />
      )}
      <ShapeRenderer item={item} />
    </g>
  )
}

function ShapeFillFrozen({ item, progress }: { item: CrashItem; progress: number }) {
  const fillId = `crash-fill-frozen-${item.id}`
  const clamped = Math.min(1, Math.max(0, progress))
  const offset = `${(clamped * 100).toFixed(1)}%`

  return (
    <g>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={COLORS.stroke} />
          <stop offset={offset} stopColor={COLORS.stroke} />
          <stop offset={offset} stopColor="transparent" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      {item.shape === 'circle' ? (
        <circle r={SHAPE_SIZE * 0.8} fill={`url(#${fillId})`} stroke="none" />
      ) : (
        <rect
          x={-SHAPE_SIZE * 0.7}
          y={-SHAPE_SIZE * 0.7}
          width={SHAPE_SIZE * 1.4}
          height={SHAPE_SIZE * 1.4}
          fill={`url(#${fillId})`}
          stroke="none"
        />
      )}
      <ShapeRenderer item={item} />
    </g>
  )
}

function QueueItemElement({ item, slotIndex }: { item: CrashItem; slotIndex: number }) {
  const x = QUEUE_SLOTS[slotIndex] ?? QUEUE_SLOTS[QUEUE_SLOTS.length - 1]
  const entryY =
    item.entryFromWorker !== undefined
      ? (WORKER_Y_POSITIONS[item.entryFromWorker] ?? QUEUE_CENTER_Y)
      : QUEUE_CENTER_Y
  const entryX = item.entryFromWorker !== undefined ? WORKER_X : QUEUE_ENTRY_X
  const isRequeue = item.entryFromWorker !== undefined
  const arcOffset = isRequeue
    ? item.entryFromWorker === 0
      ? -10
      : item.entryFromWorker === 2
        ? 10
        : -8
    : 0
  const animateY = useMemo(
    () => (isRequeue ? [entryY, QUEUE_CENTER_Y + arcOffset, QUEUE_CENTER_Y] : QUEUE_CENTER_Y),
    [arcOffset, entryY, isRequeue]
  )

  return (
    <motion.g
      initial={{ opacity: 0, x: entryX, y: entryY }}
      animate={{ opacity: 1, x, y: animateY }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ duration: QUEUE_MOVE_S, ease: [0.16, 1, 0.3, 1] }}
    >
      <ShapeRenderer item={item} />
    </motion.g>
  )
}

function InFlightElement({
  item,
  workerY,
  durationMs,
  isFailing,
  frozenProgress,
}: {
  item: CrashItem
  workerY: number
  durationMs: number | null
  isFailing: boolean
  frozenProgress: number | null
}) {
  const shouldFill = durationMs !== null && !(isFailing && item.isFaulty)
  return (
    <motion.g
      initial={{ opacity: 0, x: QUEUE_SLOTS[0], y: QUEUE_CENTER_Y }}
      animate={{ opacity: 1, x: WORKER_X, y: workerY }}
      exit={{ opacity: 0, scale: 0.4 }}
      transition={{ duration: QUEUE_MOVE_S, ease: [0.16, 1, 0.3, 1] }}
    >
      {shouldFill ? (
        <ShapeFill item={item} durationMs={durationMs} />
      ) : isFailing && item.isFaulty ? (
        <ShapeFillFrozen item={item} progress={frozenProgress ?? 0} />
      ) : (
        <ShapeRenderer item={item} />
      )}
    </motion.g>
  )
}

function WorkerContainer({ y, isFailing }: { y: number; isFailing: boolean }) {
  return (
    <motion.g
      animate={isFailing ? { x: [0, -1.5, 1.5, -1, 0] } : { x: 0 }}
      transition={{ duration: FAILURE_ANIMATION_S, ease: 'easeInOut' }}
    >
      <rect
        x={WORKER_X - WORKER_BOX_SIZE.width / 2}
        y={y - WORKER_BOX_SIZE.height / 2}
        width={WORKER_BOX_SIZE.width}
        height={WORKER_BOX_SIZE.height}
        rx={4}
        fill="none"
        strokeDasharray="4 2"
        strokeWidth={1}
        stroke={isFailing ? COLORS.strokeFail : COLORS.strokeMuted}
        opacity={isFailing ? 0.7 : 1}
        style={{ transition: 'opacity 200ms ease-out' }}
      />
    </motion.g>
  )
}

function FlowChevron() {
  const y = QUEUE_CENTER_Y
  return (
    <path
      d={`M164 ${y} L172 ${y} M168 ${y - 4} L172 ${y} L168 ${y + 4}`}
      fill="none"
      stroke={COLORS.strokeMuted}
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function DeadLetterItem({ fromWorkerId }: { fromWorkerId: number }) {
  const fromY = WORKER_Y_POSITIONS[fromWorkerId] ?? QUEUE_CENTER_Y
  return (
    <motion.g
      initial={{ opacity: 0, x: WORKER_X, y: fromY, scale: 0.6 }}
      animate={{ opacity: 0.8, x: WORKER_X, y: fromY, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6, y: fromY + 6 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <FragmentScatter stroke={COLORS.strokeFail} />
    </motion.g>
  )
}

export default function CrashRecoveryVisual() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches)
    handleChange()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  const animatedState = useCrashRecoveryAnimation({ enabled: !prefersReducedMotion })
  const { queue, workers, deadLetter, failingWorkerId } = prefersReducedMotion
    ? STATIC_STATE
    : animatedState

  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      minH={{ base: '140px', md: '180px' }}
      bg="transparent"
      rounded="lg"
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <svg
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Crash recovery visualization showing requeue and dead letter handling"
        role="img"
      >
        <FlowChevron />

        <AnimatePresence>
          {queue.map((item, index) => {
            if (!item) return null
            return <QueueItemElement key={item.id} item={item} slotIndex={index} />
          })}
        </AnimatePresence>

        {WORKER_Y_POSITIONS.map((workerY, index) => {
          const worker: WorkerSlot | undefined = workers[index]
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static array of worker positions, never reordered
            <g key={index}>
              <WorkerContainer y={workerY} isFailing={failingWorkerId === index} />
              <AnimatePresence>
                {worker?.item ? (
                  <InFlightElement
                    key={worker.item.id}
                    item={worker.item}
                    workerY={workerY}
                    durationMs={worker.durationMs}
                    isFailing={failingWorkerId === index}
                    frozenProgress={worker.frozenProgress ?? null}
                  />
                ) : null}
              </AnimatePresence>
            </g>
          )
        })}

        <AnimatePresence>
          {deadLetter ? (
            <DeadLetterItem key={deadLetter.id} fromWorkerId={deadLetter.fromWorkerId} />
          ) : null}
        </AnimatePresence>
      </svg>
    </Box>
  )
}
