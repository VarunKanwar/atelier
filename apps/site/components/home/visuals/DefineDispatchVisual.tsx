import { Box } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  EXIT_DURATION,
  INFERENCE_DURATION,
  INFERENCE_WORKERS,
  INITIAL_ITEMS,
  type PipelineItem,
  type PipelineStage,
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

const COLORS = {
  surface: '#fff',
  outline: '#CBD5E1',
  muted: '#9CA3AF',
  textMuted: '#64748b',
  textStrong: '#333',
  ink: '#111827',
  inkDeep: '#0B0F14',
  warnStroke: '#D6A896',
  dangerStroke: '#C58B78',
  rainbowStops: ['#22d3ee', '#08090a', '#8b5cf6', '#ec4899', '#f97316', '#facc15'],
} as const

// Layout anchors for the pipeline diagram in SVG coordinate space.
const STROKE_WIDTH_BASE = 1.5
const PACKET_THICKNESS = 0
const PACKET_GLOW_THICKNESS = 1.5
const PACKET_LENGTH_PX = 28
const WORKER_STEP_MS = 220
const CURVE_BEND = 30
// Isometric stack: each paper shifts diagonally as it stacks
const PHOTO_STACK_OFFSET_X = 0
const PHOTO_STACK_OFFSET_Y = -3.5
const PHOTO_STACK_PADDING = 8
const PHOTO_SKEW_DEG = 20 // Positive skew: edge/corner faces viewer

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

type StageVisualConfig = {
  pathKey: keyof typeof PATHS | ((item: PipelineItem) => keyof typeof PATHS)
  accent: string | ((item: PipelineItem) => string)
  durationMs: number
  startOffset?: string
  endOffset?: string
  queueOffset?: (queueIndex: number) => string
}

const STAGE_VISUALS: Record<PipelineStage, StageVisualConfig> = {
  'preprocess-queue': {
    pathKey: 'intro',
    accent: COLORS.muted,
    durationMs: TRAVEL_DURATION,
    startOffset: '0%',
    queueOffset: index => `${Math.max(0, 95 - index * 3)}%`,
  },
  preprocess: {
    pathKey: 'intro',
    accent: COLORS.muted,
    durationMs: PREPROCESS_DURATION,
    startOffset: '95%',
    endOffset: '95%',
  },
  'thumb-queue': {
    pathKey: 'thumb',
    accent: COLORS.muted,
    durationMs: TRAVEL_DURATION,
    startOffset: '0%',
    queueOffset: index => `${Math.max(0, 95 - index * 3)}%`,
  },
  'thumb-process': {
    pathKey: 'thumb',
    accent: COLORS.inkDeep,
    durationMs: THUMB_DURATION,
    startOffset: '95%',
    endOffset: '95%',
  },
  'inference-queue': {
    pathKey: 'infer',
    accent: COLORS.muted,
    durationMs: TRAVEL_DURATION,
    startOffset: '0%',
    queueOffset: index => `${Math.max(0, 95 - index * 3)}%`,
  },
  'inference-process': {
    pathKey: 'infer',
    accent: COLORS.ink,
    durationMs: INFERENCE_DURATION,
    startOffset: '95%',
    endOffset: '95%',
  },
  done: {
    pathKey: item => (item.type === 'thumb' ? 'thumbExit' : 'inferExit'),
    accent: item =>
      item.type === 'thumb' ? COLORS.inkDeep : COLORS.ink,
    durationMs: EXIT_DURATION,
    startOffset: '0%',
    endOffset: '100%',
  },
}

export default function DefineDispatchVisual() {
  const { items, completedCount, cycle, uploadState, uploadCueActive } = usePipelineSimulation()
  const pathLengths = usePathLengths(PATHS)
  const isUploading = uploadState.phase === 'upload'
  const uploadIconColor = uploadCueActive ? COLORS.muted : COLORS.outline

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
        aria-label="Pipeline visualization showing task dispatching flow"
        role="img"
      >
        <defs>
          <linearGradient
            id="packet-rainbow"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="500"
            y2="0"
          >
            {COLORS.rainbowStops.map((color, index) => (
              <stop
                // biome-ignore lint/suspicious/noArrayIndexKey: stable array for static gradient.
                key={index}
                offset={`${(index / (COLORS.rainbowStops.length - 1)) * 100}%`}
                stopColor={color}
              />
            ))}
          </linearGradient>
          <filter
            id="packet-glow"
            filterUnits="userSpaceOnUse"
            x="-20"
            y="-20"
            width="540"
            height="340"
          >
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* --- DAG EDGES (Static Pipes) --- */}
        <g
          stroke={COLORS.outline}
          fill="none"
          strokeWidth={STROKE_WIDTH_BASE}
          strokeLinecap="round"
        >
          <path d={PATHS.intro} />
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
            <rect
              width={NODES.start.width}
              height={NODES.start.height}
              rx={NODES.start.radius}
              fill={COLORS.surface}
              stroke={COLORS.outline}
            />
            {isUploading ? (
              <UploadCue
                width={NODES.start.width}
                height={NODES.start.height}
                labelColor={uploadIconColor}
                isAnimating={!uploadCueActive}
              />
            ) : null}
            <motion.g
              initial={false}
              animate={{ opacity: isUploading ? 0 : 1, y: isUploading ? 4 : 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <PhotoStack
                containerWidth={NODES.start.width}
                containerHeight={NODES.start.height}
                count={INITIAL_ITEMS}
                completedCount={completedCount}
                radius={NODES.start.radius}
              />
            </motion.g>
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
              fill={COLORS.surface}
              stroke={COLORS.outline}
            />
            <TextOverlay
              x={NODES.end.width / 2}
              y={NODES.end.height / 2 + 4}
              text={String(completedCount)}
              color={COLORS.textStrong}
            />
          </g>
        </g>
      </svg>
    </Box>
  )
}

const UploadCue = ({
  width,
  height,
  labelColor,
  isAnimating,
}: {
  width: number
  height: number
  labelColor: string
  isAnimating: boolean
}) => {
  const centerX = width / 2
  const trayWidth = width * 0.42
  const trayHeight = height * 0.12
  const trayY = height * 0.58
  const innerArrowTop = height * 0.28
  const innerArrowHead = 6
  const iconOffsetY = height / 2 - (innerArrowTop + trayY) / 2

  return (
    <g transform={`translate(0, ${iconOffsetY})`}>
      <line
        x1={centerX - trayWidth / 2}
        y1={trayY}
        x2={centerX + trayWidth / 2}
        y2={trayY}
        stroke={labelColor}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1={centerX - trayWidth / 2}
        y1={trayY}
        x2={centerX - trayWidth / 2}
        y2={trayY - trayHeight}
        stroke={labelColor}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1={centerX + trayWidth / 2}
        y1={trayY}
        x2={centerX + trayWidth / 2}
        y2={trayY - trayHeight}
        stroke={labelColor}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {isAnimating ? (
        <motion.g
          animate={{ y: [0, -4, 0], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        >
          <line
            x1={centerX}
            y1={trayY - trayHeight - 4}
            x2={centerX}
            y2={innerArrowTop}
            stroke={labelColor}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <polyline
            points={`${centerX - innerArrowHead},${innerArrowTop + innerArrowHead} ${centerX},${
              innerArrowTop
            } ${centerX + innerArrowHead},${innerArrowTop + innerArrowHead}`}
            fill="none"
            stroke={labelColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.g>
      ) : (
        <g>
          <line
            x1={centerX}
            y1={trayY - trayHeight - 4}
            x2={centerX}
            y2={innerArrowTop}
            stroke={labelColor}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <polyline
            points={`${centerX - innerArrowHead},${innerArrowTop + innerArrowHead} ${centerX},${
              innerArrowTop
            } ${centerX + innerArrowHead},${innerArrowTop + innerArrowHead}`}
            fill="none"
            stroke={labelColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </g>
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
  const config = STAGE_VISUALS[item.stage]
  const pathKey = typeof config.pathKey === 'function' ? config.pathKey(item) : config.pathKey
  const path = PATHS[pathKey]
  const accent = typeof config.accent === 'function' ? config.accent(item) : config.accent
  const startOffset = config.startOffset ?? '0%'
  const finalOffset = config.queueOffset
    ? config.queueOffset(queueIndex)
    : (config.endOffset ?? '100%')
  const duration = config.durationMs / 1000

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
        filter="url(#packet-glow)"
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
  // Node appearance encodes load and activity
  let fillColor: string = COLORS.surface
  let strokeColor: string = COLORS.outline

  const pressure = queueLen / Math.max(1, maxWorkers)
  if (pressure > 1.5) strokeColor = COLORS.dangerStroke
  else if (pressure > 0.75) strokeColor = COLORS.warnStroke
  else if (isActive) strokeColor = COLORS.textMuted

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
        strokeWidth={isActive || queueLen > 0 ? 1.25 : 1}
        animate={{ fill: fillColor, stroke: strokeColor }}
        transition={{ duration: 0.3 }}
      />

      <text y="40" fontSize="10" textAnchor="middle" fill={COLORS.textMuted} fontWeight="medium">
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
        const stroke = completedCount > stackCount - 1 - i ? COLORS.muted : COLORS.outline

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
              fill={COLORS.surface}
              stroke={stroke}
            />
          </g>
        )
      })}
    </g>
  )
}
