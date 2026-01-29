import { Box } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  type InFlightItem,
  QUEUE_SLOTS,
  type QueuedItem,
  type Shape,
  STATIC_IN_FLIGHT,
  STATIC_QUEUE,
  useCancellationAnimation,
  WORKER_X,
} from './hooks/useCancellationAnimation'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VIEWBOX = { width: 320, height: 80 }
const SHAPE_SIZE = 6
const WORKER_BOX = { x: 184, y: 24, width: 80, height: 32 }
const CENTER_Y = 40

const COLORS = {
  stroke: 'var(--stroke-subtle)',
  strokeMuted: 'var(--stroke-muted)',
  textMuted: 'var(--text-muted)',
} as const

// -----------------------------------------------------------------------------
// Shape Rendering
// -----------------------------------------------------------------------------

function polygonPoints(radius: number, sides: number): string {
  const angleOffset = -Math.PI / 2
  return Array.from({ length: sides }, (_, i) => {
    const angle = angleOffset + (2 * Math.PI * i) / sides
    return `${radius * Math.cos(angle)},${radius * Math.sin(angle)}`
  }).join(' ')
}

function ShapeRenderer({ shape }: { shape: Shape }) {
  const stroke = COLORS.stroke
  const strokeWidth = 1

  switch (shape) {
    case 'circle':
      return <circle r={SHAPE_SIZE * 0.8} fill="none" stroke={stroke} strokeWidth={strokeWidth} />

    case 'triangle':
      return (
        <polygon
          points={polygonPoints(SHAPE_SIZE, 3)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )

    case 'square': {
      const s = SHAPE_SIZE * 1.4
      return (
        <rect
          x={-s / 2}
          y={-s / 2}
          width={s}
          height={s}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )
    }

    case 'diamond':
      return (
        <polygon
          points={polygonPoints(SHAPE_SIZE, 4)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )

    case 'pentagon':
      return (
        <polygon
          points={polygonPoints(SHAPE_SIZE, 5)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )

    case 'hexagon':
      return (
        <polygon
          points={polygonPoints(SHAPE_SIZE, 6)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )
  }
}

// -----------------------------------------------------------------------------
// Queue Item - position derived from array index, animated with Framer Motion
// -----------------------------------------------------------------------------

interface QueueItemProps {
  item: QueuedItem
  slotIndex: number
}

function QueueItemElement({ item, slotIndex }: QueueItemProps) {
  const x = QUEUE_SLOTS[slotIndex]

  return (
    <motion.g
      initial={{ opacity: 0, x: x - 20 }}
      animate={{ opacity: 1, x, y: CENTER_Y }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <ShapeRenderer shape={item.shape} />
    </motion.g>
  )
}

// -----------------------------------------------------------------------------
// In-Flight Item - always at worker position
// -----------------------------------------------------------------------------

interface InFlightProps {
  item: InFlightItem
}

function InFlightElement({ item }: InFlightProps) {
  return (
    <motion.g
      initial={{ opacity: 0, x: QUEUE_SLOTS[0] }}
      animate={{ opacity: 1, x: WORKER_X, y: CENTER_Y }}
      exit={{ opacity: 0, x: WORKER_X + 30 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <ShapeRenderer shape={item.shape} />
    </motion.g>
  )
}

// -----------------------------------------------------------------------------
// Static Elements
// -----------------------------------------------------------------------------

function WorkerContainer() {
  return (
    <rect
      x={WORKER_BOX.x}
      y={WORKER_BOX.y}
      width={WORKER_BOX.width}
      height={WORKER_BOX.height}
      rx={4}
      fill="none"
      stroke={COLORS.strokeMuted}
      strokeWidth={1}
      strokeDasharray="4 2"
    />
  )
}

function FlowChevron() {
  return (
    <path
      d="M164 40 L172 40 M168 36 L172 40 L168 44"
      fill="none"
      stroke={COLORS.strokeMuted}
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function PredicateLabel({ text, phase }: { text: string; phase: 'idle' | 'typing' | 'executing' }) {
  const show = phase !== 'idle'
  const cursor = phase === 'typing' ? '|' : ''

  return (
    <text
      x={24}
      y={14}
      fontSize={9}
      fontFamily="var(--font-mono)"
      fill={COLORS.textMuted}
      style={{
        transition: 'opacity 200ms ease-out',
        opacity: show ? (phase === 'executing' ? 0.9 : 0.7) : 0,
      }}
    >
      &gt; {text}
      {cursor}
    </text>
  )
}

// -----------------------------------------------------------------------------
// Main Component
// -----------------------------------------------------------------------------

export default function CancellationVisual() {
  // Reduced motion preference
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
  }, [])

  const animatedState = useCancellationAnimation()

  // Use static data for reduced motion
  const queue = prefersReducedMotion ? STATIC_QUEUE : animatedState.queue
  const inFlight = prefersReducedMotion ? STATIC_IN_FLIGHT : animatedState.inFlight
  const commandText = prefersReducedMotion ? '' : animatedState.commandText
  const commandPhase = prefersReducedMotion ? 'idle' : animatedState.commandPhase

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
        aria-label="Cancellation visualization showing predicate-based selective cancellation"
        role="img"
      >
        {/* Static elements */}
        <WorkerContainer />
        <FlowChevron />

        {/* Predicate label */}
        <PredicateLabel text={commandText} phase={commandPhase} />

        {/* Queue items with AnimatePresence for enter/exit */}
        <AnimatePresence>
          {queue.map((item, index) => (
            <QueueItemElement key={item.id} item={item} slotIndex={index} />
          ))}
        </AnimatePresence>

        {/* In-flight item with AnimatePresence */}
        <AnimatePresence>
          {inFlight && <InFlightElement key={inFlight.id} item={inFlight} />}
        </AnimatePresence>

      </svg>
    </Box>
  )
}
