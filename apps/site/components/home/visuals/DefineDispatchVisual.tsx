import { Box } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  EXIT_DURATION,
  INFERENCE_DURATION,
  INFERENCE_WORKERS,
  INITIAL_ITEMS,
  type PipelineItem,
  PREPROCESS_DURATION,
  PREPROCESS_WORKERS,
  THUMB_DURATION,
  THUMB_WORKERS,
  TRAVEL_DURATION,
  usePipelineSimulation,
} from './hooks/usePipelineSimulation'

/*
 * Visual intent: a stylized, mechanistic view of an Atelier-powered workflow.
 * A local photo album app runs a DAG: preprocess → split into thumbnails + classification
 * → join into the gallery. Packets represent images moving through the runtime, with
 * queueing and processing states visible to emphasize worker pools vs singleton
 * bottlenecks and backpressure under load.
 */

// Layout anchors for the pipeline diagram in SVG coordinate space.
const STROKE_WIDTH_BASE = 2
const PIPE_STROKE = 'url(#pipe-gradient)'
const PIPE_INTRO_STROKE = '#cbd5e1'
const PIPE_COLOR_DARK = '#CBD5E1'
const PACKET_THICKNESS = 2
const PACKET_GLOW_THICKNESS = 2
const PACKET_LENGTH_PX = 20
const WORKER_STEP_MS = 220
const CURVE_BEND = 30
// Isometric stack: each paper shifts diagonally as it stacks
const PHOTO_STACK_OFFSET_X = 0
const PHOTO_STACK_OFFSET_Y = -3.5
const PHOTO_STACK_PADDING = 8
const PHOTO_SKEW_DEG = 20 // Positive skew: edge/corner faces viewer
const PHOTO_BORDER_IDLE = '#cbd5e1'
const PHOTO_BORDER_DONE = '#86efac'

const NODES = {
  start: { x: 45, y: 150, width: 80, height: 80, radius: 10 },
  preprocess: { x: 160, y: 150, width: 48, height: 32, radius: 6 },
  thumbCenter: { x: 280, y: 90, width: 48, height: 32, radius: 6 },
  inferCenter: { x: 280, y: 210, width: 48, height: 32, radius: 6 },
  end: { x: 440, y: 150, width: 80, height: 80, radius: 10 },
}

const edgeX = (node: { x: number; width: number }, side: 'left' | 'right') =>
  node.x + (side === 'left' ? -node.width / 2 : node.width / 2)

// Motion paths used by packets as they move through the pipeline.
const PATHS = {
  // Entry: Start -> Preprocess
  intro: `M ${edgeX(NODES.start, 'right')} ${NODES.start.y} L ${edgeX(NODES.preprocess, 'left')} ${NODES.preprocess.y}`,

  // Branch A: Preprocess -> Split -> Thumbnails
  thumb: `M ${edgeX(NODES.preprocess, 'right')} ${NODES.preprocess.y} C ${edgeX(NODES.preprocess, 'right') + CURVE_BEND} ${NODES.preprocess.y}, ${edgeX(NODES.thumbCenter, 'left') - CURVE_BEND} ${NODES.thumbCenter.y}, ${edgeX(NODES.thumbCenter, 'left')} ${NODES.thumbCenter.y}`,

  // Branch B: Preprocess -> Split -> Inference
  infer: `M ${edgeX(NODES.preprocess, 'right')} ${NODES.preprocess.y} C ${edgeX(NODES.preprocess, 'right') + CURVE_BEND} ${NODES.preprocess.y}, ${edgeX(NODES.inferCenter, 'left') - CURVE_BEND} ${NODES.inferCenter.y}, ${edgeX(NODES.inferCenter, 'left')} ${NODES.inferCenter.y}`,

  // Merge: branch output -> Join -> End
  thumbExit: `M ${edgeX(NODES.thumbCenter, 'right')} ${NODES.thumbCenter.y} C ${edgeX(NODES.thumbCenter, 'right') + CURVE_BEND} ${NODES.thumbCenter.y}, ${edgeX(NODES.end, 'left') - CURVE_BEND} ${NODES.end.y}, ${edgeX(NODES.end, 'left')} ${NODES.end.y}`,

  inferExit: `M ${edgeX(NODES.inferCenter, 'right')} ${NODES.inferCenter.y} C ${edgeX(NODES.inferCenter, 'right') + CURVE_BEND} ${NODES.inferCenter.y}, ${edgeX(NODES.end, 'left') - CURVE_BEND} ${NODES.end.y}, ${edgeX(NODES.end, 'left')} ${NODES.end.y}`,
}

export default function DefineDispatchVisual() {
  const { items, completedCount, cycle } = usePipelineSimulation()
  const pathLengths = usePathLengths(PATHS)

  // Pre-calculate queues
  const preprocessQueue = items
    .filter((i: PipelineItem) => i.stage === 'preprocess-queue')
    .sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)
  const inferQueue = items
    .filter((i: PipelineItem) => i.stage === 'inference-queue')
    .sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)
  const thumbQueue = items
    .filter((i: PipelineItem) => i.stage === 'thumb-queue')
    .sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)

  const preprocessActive = items.filter((i: PipelineItem) => i.stage === 'preprocess').length
  const thumbActive = items.filter((i: PipelineItem) => i.stage === 'thumb-process').length
  const inferenceActive = items.filter((i: PipelineItem) => i.stage === 'inference-process').length
  const preprocessActiveDisplay = useSteppedCount(preprocessActive, WORKER_STEP_MS)
  const thumbActiveDisplay = useSteppedCount(thumbActive, WORKER_STEP_MS)
  const inferenceActiveDisplay = useSteppedCount(inferenceActive, WORKER_STEP_MS)
  const inferenceQueueLen = inferQueue.length
  const isInferenceProcessing = inferenceActiveDisplay > 0

  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      minH={{ base: '260px', md: '300px' }}
      bg="transparent"
      rounded="lg"
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <svg
        viewBox="0 0 500 300"
        style={{ width: '100%', height: '100%', maxWidth: '600px' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="pipe-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#cbd5e1" />
            <stop offset="50%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <linearGradient id="packet-rainbow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="20%" stopColor="#3b82f6" />
            <stop offset="40%" stopColor="#8b5cf6" />
            <stop offset="60%" stopColor="#ec4899" />
            <stop offset="80%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>
          <filter id="packet-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="packet-glow-strong" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* --- DAG EDGES (Static Pipes) --- */}
        <g stroke={PIPE_STROKE} fill="none" strokeWidth={STROKE_WIDTH_BASE} strokeLinecap="round">
          <path d={PATHS.intro} stroke={PIPE_INTRO_STROKE} />
          <path d={PATHS.thumb} />
          <path d={PATHS.infer} />
          <path d={PATHS.thumbExit} />
          <path d={PATHS.inferExit} />
        </g>

        <g key={cycle}>
          {/* --- PACKETS --- */}
          {/* Packets are animated as glowing path segments (dash offset). */}
          <AnimatePresence initial={false}>
            {items.map((item: PipelineItem) => {
              let queueIndex = -1
              if (item.stage === 'preprocess-queue') {
                queueIndex = preprocessQueue.findIndex((i: PipelineItem) => i.id === item.id)
              } else if (item.stage === 'inference-queue') {
                queueIndex = inferQueue.findIndex((i: PipelineItem) => i.id === item.id)
              } else if (item.stage === 'thumb-queue') {
                queueIndex = thumbQueue.findIndex((i: PipelineItem) => i.id === item.id)
              }

              return (
                <Packet
                  key={`${item.id}-${item.stage}`}
                  item={item}
                  queueIndex={queueIndex}
                  pathLengths={pathLengths}
                />
              )
            })}
          </AnimatePresence>

          {/* --- NODES --- */}
          <MachineNode
            x={NODES.preprocess.x}
            y={NODES.preprocess.y}
            width={NODES.preprocess.width}
            height={NODES.preprocess.height}
            radius={NODES.preprocess.radius}
            label="Preprocess"
            isActive={preprocessActiveDisplay > 0}
            activeWorkers={preprocessActiveDisplay}
            maxWorkers={PREPROCESS_WORKERS}
          />
          <MachineNode
            x={NODES.thumbCenter.x}
            y={NODES.thumbCenter.y}
            width={NODES.thumbCenter.width}
            height={NODES.thumbCenter.height}
            radius={NODES.thumbCenter.radius}
            label="Thumbnails"
            isActive={thumbActiveDisplay > 0}
            activeWorkers={thumbActiveDisplay}
            maxWorkers={THUMB_WORKERS}
            variant="pool"
          />
          <MachineNode
            x={NODES.inferCenter.x}
            y={NODES.inferCenter.y}
            width={NODES.inferCenter.width}
            height={NODES.inferCenter.height}
            radius={NODES.inferCenter.radius}
            label="Inference"
            isActive={isInferenceProcessing}
            activeWorkers={inferenceActiveDisplay}
            maxWorkers={INFERENCE_WORKERS}
            variant="singleton"
            queueLen={inferenceQueueLen}
          />

          {/* --- INPUT --- */}
          <g
            transform={`translate(${NODES.start.x - NODES.start.width / 2}, ${NODES.start.y - NODES.start.height / 2})`}
          >
            <text fontSize="10" fill="#64748b" x={NODES.start.width / 2} y="-8" textAnchor="middle">
              Album
            </text>
            <rect
              width={NODES.start.width}
              height={NODES.start.height}
              rx={NODES.start.radius}
              fill="#fff"
              stroke={PIPE_COLOR_DARK}
            />
            <PhotoStack
              containerWidth={NODES.start.width}
              containerHeight={NODES.start.height}
              count={INITIAL_ITEMS}
              completedCount={completedCount}
              radius={NODES.start.radius}
            />
          </g>

          {/* --- OUTPUT --- */}
          <g
            transform={`translate(${NODES.end.x - NODES.end.width / 2}, ${NODES.end.y - NODES.end.height / 2})`}
          >
            <text fontSize="9" fill="gray" x={NODES.end.width / 2} y="-8" textAnchor="middle">
              Gallery
            </text>
            <rect
              width={NODES.end.width}
              height={NODES.end.height}
              rx={NODES.end.radius}
              fill="#fff"
              stroke={PIPE_COLOR_DARK}
            />
            <TextOverlay
              x={NODES.end.width / 2}
              y={NODES.end.height / 2 + 4}
              text={String(completedCount)}
              color="#333"
            />
          </g>
        </g>
      </svg>
    </Box>
  )
}

const useSteppedCount = (target: number, stepMs: number) => {
  const [displayValue, setDisplayValue] = useState(target)

  useEffect(() => {
    if (displayValue === target) return
    const timer = globalThis.setTimeout(() => {
      setDisplayValue(current => current + (target > current ? 1 : -1))
    }, stepMs)
    return () => clearTimeout(timer)
  }, [displayValue, target, stepMs])

  return displayValue
}

const getCenteredSlots = (count: number, max: number) => {
  if (max <= 0 || count <= 0) return []
  const clamped = Math.min(count, max)
  const start = Math.floor((max - clamped) / 2)
  return Array.from({ length: clamped }, (_, index) => start + index)
}

const usePathLengths = (paths: Record<string, string>) => {
  const [lengths, setLengths] = useState<Record<string, number>>({})

  useEffect(() => {
    if (typeof document === 'undefined') return
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const next: Record<string, number> = {}
    for (const [key, d] of Object.entries(paths)) {
      pathEl.setAttribute('d', d)
      next[key] = pathEl.getTotalLength()
    }
    setLengths(next)
  }, [paths])

  return lengths
}

function Packet({
  item,
  queueIndex,
  pathLengths,
}: {
  item: PipelineItem
  queueIndex: number
  pathLengths: Record<string, number>
}) {
  // Used to select the correct exit path once the item completes.
  const isThumb = item.type === 'thumb'

  // Stage → motion recipe (path, offsets, duration, accent).
  let pathKey: keyof typeof PATHS = 'intro'
  let path = ''
  let finalOffset = '100%'
  let startOffset = '0%'
  let duration = 0
  let accent = '#94a3b8'

  if (item.stage === 'preprocess-queue') {
    pathKey = 'intro'
    path = PATHS.intro
    duration = TRAVEL_DURATION / 1000
    accent = '#38bdf8'
    startOffset = '0%'
    // Stack queue items by backing up along the path.
    finalOffset = `${Math.max(0, 95 - queueIndex * 3)}%`
  } else if (item.stage === 'preprocess') {
    pathKey = 'intro'
    path = PATHS.intro
    duration = PREPROCESS_DURATION / 1000
    accent = '#38bdf8'
    // Hold at the worker node while processing.
    startOffset = '95%'
    finalOffset = '95%'
  } else if (item.stage === 'thumb-queue') {
    pathKey = 'thumb'
    path = PATHS.thumb
    accent = '#a78bfa'
    startOffset = '0%'
    // Stack queue items by backing up along the path.
    finalOffset = `${Math.max(0, 95 - queueIndex * 3)}%`
    duration = TRAVEL_DURATION / 1000
  } else if (item.stage === 'thumb-process') {
    pathKey = 'thumb'
    path = PATHS.thumb
    accent = '#60a5fa'
    // Hold at the worker node while processing.
    startOffset = '95%'
    finalOffset = '95%'
    duration = THUMB_DURATION / 1000
  } else if (item.stage === 'inference-queue') {
    pathKey = 'infer'
    path = PATHS.infer
    accent = '#fbbf24'
    startOffset = '0%'
    // Stack queue items by backing up along the path.
    finalOffset = `${Math.max(0, 95 - queueIndex * 3)}%`
    duration = TRAVEL_DURATION / 1000
  } else if (item.stage === 'inference-process') {
    pathKey = 'infer'
    path = PATHS.infer
    accent = '#f43f5e'
    // Hold at the worker node while processing.
    startOffset = '95%'
    finalOffset = '95%'
    duration = INFERENCE_DURATION / 1000
  } else if (item.stage === 'done') {
    pathKey = isThumb ? 'thumbExit' : 'inferExit'
    path = isThumb ? PATHS.thumbExit : PATHS.inferExit
    accent = isThumb ? '#60a5fa' : '#f43f5e'
    startOffset = '0%'
    finalOffset = '100%'
    duration = EXIT_DURATION / 1000
  }

  const isProcess = item.stage.includes('process')
  const lengthPx = pathLengths[pathKey] ?? 100
  const segmentPercent = Math.min(100, (PACKET_LENGTH_PX / Math.max(1, lengthPx)) * 100)
  const dashArray = `${segmentPercent} ${100 - segmentPercent}`
  const clampOffset = (value: number) => Math.min(Math.max(0, value), 100 - segmentPercent)
  const startPercent = clampOffset(Number.parseFloat(startOffset))
  const endPercent = clampOffset(Number.parseFloat(finalOffset))
  const startDash = -startPercent
  const endDash = -endPercent

  return (
    <g>
      <motion.path
        d={path}
        pathLength={100}
        stroke="url(#packet-rainbow)"
        fill="none"
        strokeWidth={PACKET_GLOW_THICKNESS}
        strokeLinecap="round"
        strokeDasharray={dashArray}
        filter={isProcess ? 'url(#packet-glow-strong)' : 'url(#packet-glow)'}
        initial={{ strokeDashoffset: startDash, opacity: 0.9 }}
        animate={{
          strokeDashoffset: endDash,
          opacity: isProcess ? [0.9, 0.5, 0.9] : 0.9,
        }}
        transition={{
          duration: duration,
          ease: 'linear',
          opacity: { repeat: isProcess ? Infinity : 0, duration: 0.5 },
        }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
      />
      <motion.path
        d={path}
        pathLength={100}
        stroke={accent}
        fill="none"
        strokeWidth={PACKET_THICKNESS}
        strokeLinecap="round"
        strokeDasharray={dashArray}
        initial={{ strokeDashoffset: startDash, opacity: 1 }}
        animate={{
          strokeDashoffset: endDash,
          opacity: isProcess ? [1, 0.6, 1] : 1,
        }}
        transition={{
          duration: duration,
          ease: 'linear',
          opacity: { repeat: isProcess ? Infinity : 0, duration: 0.5 },
        }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
      />
    </g>
  )
}

function MachineNode({
  x,
  y,
  width,
  height,
  radius,
  label,
  isActive,
  variant,
  activeWorkers = 0,
  maxWorkers = activeWorkers,
  queueLen = 0,
}: {
  x: number
  y: number
  width: number
  height: number
  radius: number
  label: string
  isActive: boolean
  variant?: 'pool' | 'singleton'
  activeWorkers?: number
  maxWorkers?: number
  queueLen?: number
}) {
  // Node appearance encodes load and activity; the singleton warns on queue growth.
  let fillColor = '#fff'
  let strokeColor = '#CBD5E1'

  if (variant === 'singleton') {
    if (queueLen > 4)
      fillColor = '#fecaca' // Light Red
    else if (queueLen > 2) fillColor = '#fef08a' // Light Yellow

    if (queueLen > 4) strokeColor = '#ef4444'
    else if (queueLen > 2) strokeColor = '#eab308'
    else if (isActive) strokeColor = '#3b82f6'
  } else if (variant === 'pool') {
    if (isActive) strokeColor = '#8b5cf6'
  } else {
    // Preprocess
    if (isActive) strokeColor = '#3b82f6'
  }

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Node body + label + activity bars */}
      <motion.rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={radius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={isActive || queueLen > 0 ? 2 : 1.5}
        animate={{ fill: fillColor, stroke: strokeColor }}
        transition={{ duration: 0.3 }}
      />

      <text y="40" fontSize="10" textAnchor="middle" fill="#64748b" fontWeight="medium">
        {label}
      </text>

      {activeWorkers > 0 && (
        <g transform="translate(0, 6)">
          {getCenteredSlots(activeWorkers, maxWorkers).map(slotIndex => {
            const barWidth = 4
            const barGap = 3
            const totalWidth = maxWorkers * barWidth + (maxWorkers - 1) * barGap
            const xOffset = -totalWidth / 2 + slotIndex * (barWidth + barGap)
            return (
              <motion.rect
                key={slotIndex}
                x={xOffset}
                y={-6}
                width={barWidth}
                height={12}
                rx={2}
                fill={strokeColor}
                animate={{ height: [6, 12, 7], y: [-3, -6, -4] }}
                transition={{
                  repeat: Infinity,
                  duration: 0.8,
                  delay: slotIndex * 0.1,
                  ease: 'easeInOut',
                }}
              />
            )
          })}
        </g>
      )}
    </g>
  )
}

function TextOverlay({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill={color}
      fontSize="11"
      fontWeight="bold"
      style={{ userSelect: 'none' }}
    >
      {text}
    </text>
  )
}

function PhotoStack({
  containerWidth,
  containerHeight,
  count,
  completedCount,
  radius,
}: {
  containerWidth: number
  containerHeight: number
  count: number
  completedCount: number
  radius: number
}) {
  const stackCount = Math.max(1, count)

  // Calculate total offset needed for the full stack
  const totalOffsetX = (stackCount - 1) * Math.abs(PHOTO_STACK_OFFSET_X)
  const totalOffsetY = (stackCount - 1) * Math.abs(PHOTO_STACK_OFFSET_Y)

  // Account for skew shift (skewX shifts points based on their Y position)
  const skewRad = (PHOTO_SKEW_DEG * Math.PI) / 180
  const paperHeight = containerHeight - PHOTO_STACK_PADDING * 2 - totalOffsetY
  const skewShift = Math.abs(Math.tan(skewRad) * paperHeight)

  // Paper dimensions accounting for padding, stack spread, and skew
  const paperWidth = containerWidth - PHOTO_STACK_PADDING * 2 - totalOffsetX - skewShift

  // Base position: bottom paper starts offset to account for stack growth
  // Skew compensation keeps the visual centered in the container
  const baseX = PHOTO_STACK_PADDING + Math.abs(totalOffsetX)
  const baseY = PHOTO_STACK_PADDING + totalOffsetY

  return (
    <g>
      {Array.from({ length: stackCount }).map((_, i) => {
        // Each paper shifts up and left as we go up the stack
        const x = baseX + i * PHOTO_STACK_OFFSET_X
        const y = baseY + i * PHOTO_STACK_OFFSET_Y
        const stroke = completedCount > stackCount - 1 - i ? PHOTO_BORDER_DONE : PHOTO_BORDER_IDLE

        return (
          <g
            // biome-ignore lint/suspicious/noArrayIndexKey: static stack, no reordering
            key={i}
            transform={`translate(${x}, ${y}) skewX(${PHOTO_SKEW_DEG})`}
          >
            <rect
              x={0}
              y={0}
              width={paperWidth}
              height={paperHeight}
              rx={Math.max(2, radius - 4)}
              fill="#fff"
              stroke={stroke}
            />
          </g>
        )
      })}
    </g>
  )
}
