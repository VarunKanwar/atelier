import { Box } from '@chakra-ui/react'
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
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
  canvas: 'var(--page-bg)',
  surface: 'var(--surface)',
  strokeBase: 'var(--stroke-subtle)',
  strokeActive: 'var(--stroke-muted)',
  label: 'var(--text-muted)',
} as const

// Layout anchors for the pipeline diagram in SVG coordinate space.
const STROKE_WIDTH_BASE = 1.5
const PACKET_OUTER_WIDTH = STROKE_WIDTH_BASE * 4
const PACKET_INNER_WIDTH = STROKE_WIDTH_BASE * 2
const PACKET_LENGTH_PX = 28
const WORKER_STEP_MS = 220
const CURVE_BEND = 30
// Label layout in SVG user units: box height and gap from the node edge.
const LABEL_FONT_SIZE = 12
const LABEL_HEIGHT = 12
const LABEL_OFFSET = 6
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
  durationMs: number
  startOffset?: string
  endOffset?: string
  queueOffset?: (queueIndex: number) => string
}

const STAGE_VISUALS: Record<PipelineStage, StageVisualConfig> = {
  'preprocess-queue': {
    pathKey: 'intro',
    durationMs: TRAVEL_DURATION,
    startOffset: '0%',
    queueOffset: index => `${Math.max(0, 95 - index * 3)}%`,
  },
  preprocess: {
    pathKey: 'intro',
    durationMs: PREPROCESS_DURATION,
    startOffset: '95%',
    endOffset: '95%',
  },
  'thumb-queue': {
    pathKey: 'thumb',
    durationMs: TRAVEL_DURATION,
    startOffset: '0%',
    queueOffset: index => `${Math.max(0, 95 - index * 3)}%`,
  },
  'thumb-process': {
    pathKey: 'thumb',
    durationMs: THUMB_DURATION,
    startOffset: '95%',
    endOffset: '95%',
  },
  'inference-queue': {
    pathKey: 'infer',
    durationMs: TRAVEL_DURATION,
    startOffset: '0%',
    queueOffset: index => `${Math.max(0, 95 - index * 3)}%`,
  },
  'inference-process': {
    pathKey: 'infer',
    durationMs: INFERENCE_DURATION,
    startOffset: '95%',
    endOffset: '95%',
  },
  done: {
    pathKey: item => (item.type === 'thumb' ? 'thumbExit' : 'inferExit'),
    durationMs: EXIT_DURATION,
    startOffset: '0%',
    endOffset: '100%',
  },
}

export default function DefineDispatchVisual() {
  const {
    items,
    completedCount,
    cycle,
    uploadState,
    uploadCueActive,
    thumbCompletedCount,
    labelCompletedCount,
  } = usePipelineSimulation()
  const pathLengths = usePathLengths(PATHS)
  const isUploading = uploadState.phase === 'upload'
  const uploadIconColor = uploadCueActive ? COLORS.strokeActive : COLORS.strokeBase
  const galleryThumbCount = Math.min(thumbCompletedCount, INITIAL_ITEMS)
  const galleryLabelCount = Math.min(labelCompletedCount, galleryThumbCount)

  const {
    inferQueue,
    preprocessActive,
    thumbActive,
    inferenceActive,
    preprocessIndex,
    inferIndex,
    thumbIndex,
  } = useMemo(() => {
    const preprocessQueue: PipelineItem[] = []
    const inferQueue: PipelineItem[] = []
    const thumbQueue: PipelineItem[] = []
    let preprocessActive = 0
    let thumbActive = 0
    let inferenceActive = 0

    for (const item of items) {
      if (item.stage === 'preprocess-queue') preprocessQueue.push(item)
      else if (item.stage === 'inference-queue') inferQueue.push(item)
      else if (item.stage === 'thumb-queue') thumbQueue.push(item)
      else if (item.stage === 'preprocess') preprocessActive += 1
      else if (item.stage === 'thumb-process') thumbActive += 1
      else if (item.stage === 'inference-process') inferenceActive += 1
    }

    preprocessQueue.sort((a, b) => a.enteredStageAt - b.enteredStageAt)
    inferQueue.sort((a, b) => a.enteredStageAt - b.enteredStageAt)
    thumbQueue.sort((a, b) => a.enteredStageAt - b.enteredStageAt)

    return {
      preprocessQueue,
      inferQueue,
      thumbQueue,
      preprocessActive,
      thumbActive,
      inferenceActive,
      preprocessIndex: new Map(preprocessQueue.map((item, index) => [item.id, index])),
      inferIndex: new Map(inferQueue.map((item, index) => [item.id, index])),
      thumbIndex: new Map(thumbQueue.map((item, index) => [item.id, index])),
    }
  }, [items])
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
        {/* --- DAG EDGES (Static Pipes) --- */}
        <g
          stroke={COLORS.strokeBase}
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
          {/* Packets are animated as path segments (dash offset). */}
          <AnimatePresence initial={false}>
            {items.map((item: PipelineItem) => {
              let queueIndex = -1
              if (item.stage === 'preprocess-queue') {
                queueIndex = preprocessIndex.get(item.id) ?? -1
              } else if (item.stage === 'inference-queue') {
                queueIndex = inferIndex.get(item.id) ?? -1
              } else if (item.stage === 'thumb-queue') {
                queueIndex = thumbIndex.get(item.id) ?? -1
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
            isActive={preprocessActiveDisplay > 0}
            activeWorkers={preprocessActiveDisplay}
            maxWorkers={PREPROCESS_WORKERS}
          />
          <SvgLabel
            x={NODES.preprocess.x - NODES.preprocess.width / 2}
            y={NODES.preprocess.y + NODES.preprocess.height / 2 + LABEL_HEIGHT - LABEL_OFFSET}
            width={NODES.preprocess.width}
            text="decode"
          />

          <MachineNode
            x={NODES.thumbCenter.x}
            y={NODES.thumbCenter.y}
            width={NODES.thumbCenter.width}
            height={NODES.thumbCenter.height}
            radius={NODES.thumbCenter.radius}
            isActive={thumbActiveDisplay > 0}
            activeWorkers={thumbActiveDisplay}
            maxWorkers={THUMB_WORKERS}
          />
          <SvgLabel
            x={NODES.thumbCenter.x - NODES.thumbCenter.width / 2}
            y={NODES.thumbCenter.y + NODES.thumbCenter.height / 2 + LABEL_HEIGHT - LABEL_OFFSET}
            width={NODES.thumbCenter.width}
            text="preview"
          />

          <MachineNode
            x={NODES.inferCenter.x}
            y={NODES.inferCenter.y}
            width={NODES.inferCenter.width}
            height={NODES.inferCenter.height}
            radius={NODES.inferCenter.radius}
            isActive={isInferenceProcessing}
            activeWorkers={inferenceActiveDisplay}
            maxWorkers={INFERENCE_WORKERS}
            queueLen={inferenceQueueLen}
          />
          <SvgLabel
            x={NODES.inferCenter.x - NODES.inferCenter.width / 2}
            y={NODES.inferCenter.y + NODES.inferCenter.height / 2 + LABEL_HEIGHT - LABEL_OFFSET}
            width={NODES.inferCenter.width}
            text="classify"
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
              stroke={COLORS.strokeBase}
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
            {/* <SvgLabel x={0} y={- LABEL_HEIGHT - LABEL_OFFSET} width={NODES.end.width} text="Gallery" /> */}
            <rect
              width={NODES.end.width}
              height={NODES.end.height}
              rx={NODES.end.radius}
              fill={COLORS.surface}
              stroke={COLORS.strokeBase}
            />
            <GalleryGrid
              width={NODES.end.width}
              height={NODES.end.height}
              totalCount={INITIAL_ITEMS}
              thumbnailsFilled={galleryThumbCount}
              labelsFilled={galleryLabelCount}
              color={COLORS.strokeActive}
            />
            <SvgLabel
              x={0}
              y={NODES.end.height + LABEL_HEIGHT - LABEL_OFFSET}
              width={NODES.end.width}
              text="Gallery"
            />
          </g>
        </g>
      </svg>
    </Box>
  )
}

const SvgLabel = ({ x, y, width, text }: { x: number; y: number; width: number; text: string }) => (
  <foreignObject x={x} y={y} width={width} height={LABEL_HEIGHT} pointerEvents="none">
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${LABEL_FONT_SIZE}px`,
        lineHeight: '1',
        color: COLORS.label,
        fontWeight: 500,
      }}
    >
      {text}
    </div>
  </foreignObject>
)

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
  const outerStroke = COLORS.strokeBase
  const innerStroke = COLORS.canvas
  const startOffset = config.startOffset ?? '0%'
  const finalOffset = config.queueOffset
    ? config.queueOffset(queueIndex)
    : (config.endOffset ?? '100%')
  const duration = config.durationMs / 1000

  const lengthPx = pathLengths[pathKey] ?? 100
  const segmentPercent = Math.min(100, (PACKET_LENGTH_PX / Math.max(1, lengthPx)) * 100)
  const dashArray = `${segmentPercent} ${100 - segmentPercent}`
  const clampOffset = (value: number) => Math.min(Math.max(0, value), 100 - segmentPercent)
  const startPercent = clampOffset(Number.parseFloat(startOffset))
  const endPercent = clampOffset(Number.parseFloat(finalOffset))
  const startDash = -startPercent
  const endDash = -endPercent
  const dashOffset = useMotionValue(startDash)

  useEffect(() => {
    dashOffset.set(startDash)
    if (startDash === endDash) return
    const controls = animate(dashOffset, endDash, { duration, ease: 'linear' })
    return () => controls.stop()
  }, [dashOffset, duration, endDash, startDash])
  const dashStyle = { '--packet-dash': dashOffset } as CSSProperties

  return (
    <motion.g
      style={dashStyle}
      initial={{ opacity: 0.9 }}
      animate={{ opacity: 0.9 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    >
      <path
        d={path}
        pathLength={100}
        stroke={outerStroke}
        fill="none"
        strokeWidth={PACKET_OUTER_WIDTH}
        strokeLinecap="round"
        strokeDasharray={dashArray}
        strokeDashoffset="var(--packet-dash)"
      />
      <path
        d={path}
        pathLength={100}
        stroke={innerStroke}
        fill="none"
        strokeWidth={PACKET_INNER_WIDTH}
        strokeLinecap="round"
        strokeDasharray={dashArray}
        strokeDashoffset="var(--packet-dash)"
      />
    </motion.g>
  )
}

function MachineNode({
  x,
  y,
  width,
  height,
  radius,
  isActive,
  activeWorkers = 0,
  maxWorkers = activeWorkers,
  queueLen = 0,
}: {
  x: number
  y: number
  width: number
  height: number
  radius: number
  isActive: boolean
  activeWorkers?: number
  maxWorkers?: number
  queueLen?: number
}) {
  // Node appearance encodes load and activity
  const fillColor: string = COLORS.surface
  const pressure = queueLen / Math.max(1, maxWorkers)
  const loadRatio = Math.min(Math.max(pressure, 0), 1)
  const strokeWidth = isActive || queueLen > 0 ? 1.25 : 1

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Node body + activity bars */}
      <motion.rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={radius}
        fill={fillColor}
        stroke={COLORS.strokeBase}
        strokeWidth={strokeWidth}
        animate={{ fill: fillColor }}
        transition={{ duration: 0.3 }}
      />
      {loadRatio > 0 && (
        <motion.rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          rx={radius}
          fill="none"
          stroke={COLORS.strokeActive}
          strokeWidth={strokeWidth}
          strokeOpacity={loadRatio}
          animate={{ strokeOpacity: loadRatio }}
          transition={{ duration: 0.3 }}
          pointerEvents="none"
        />
      )}

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
                fill={COLORS.strokeActive}
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

function GalleryGrid({
  width,
  height,
  totalCount,
  thumbnailsFilled,
  labelsFilled,
  color,
}: {
  width: number
  height: number
  totalCount: number
  thumbnailsFilled: number
  labelsFilled: number
  color: string
}) {
  if (totalCount <= 0) return null

  const columns = Math.max(1, Math.ceil(Math.sqrt(totalCount)))
  const rows = Math.max(1, Math.ceil(totalCount / columns))
  const padding = 8
  const gridWidth = Math.max(0, width - padding * 2)
  const gridHeight = Math.max(0, height - padding * 2)
  const cellWidth = gridWidth / columns
  const cellHeight = gridHeight / rows
  const thumbWidth = cellWidth * 0.8
  const thumbHeight = cellHeight * 0.6
  const labelWidth = cellWidth * 0.6
  const labelHeight = Math.max(2, cellHeight * 0.16)
  const labelOffsetY = cellHeight * 0.72
  const rowOffsets = Array.from({ length: rows }).map((_, rowIndex) => {
    const visibleInRow = Math.min(columns, Math.max(0, thumbnailsFilled - rowIndex * columns))
    return ((columns - visibleInRow) * cellWidth) / 2
  })

  return (
    <g transform={`translate(${padding}, ${padding})`}>
      {Array.from({ length: totalCount }).map((_, index) => {
        const col = index % columns
        const row = Math.floor(index / columns)
        const rowOffset = rowOffsets[row] ?? 0
        const x = rowOffset + col * cellWidth + (cellWidth - thumbWidth) / 2
        const y = row * cellHeight + (cellHeight - thumbHeight) / 2 - cellHeight * 0.1
        const showThumb = index < thumbnailsFilled
        const showLabel = index < labelsFilled

        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static grid, no reordering
          <g key={index}>
            {showThumb ? (
              <rect
                x={x}
                y={y}
                width={thumbWidth}
                height={thumbHeight}
                rx={Math.max(2, thumbHeight * 0.15)}
                fill="none"
                stroke={color}
                strokeWidth={0.5}
                opacity={0.7}
              />
            ) : null}
            {/* there should be a small gap between the thumb and label */}
            {/* we achieve this by offsetting the label's y position */}
            {showLabel ? (
              <rect
                x={rowOffset + col * cellWidth + (cellWidth - labelWidth) / 2}
                y={row * cellHeight + labelOffsetY + 2}
                width={labelWidth}
                height={labelHeight}
                rx={labelHeight / 2}
                fill={color}
                stroke="none"
                strokeWidth={0.5}
                opacity={0.7}
              />
            ) : null}
          </g>
        )
      })}
    </g>
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
        const stroke = completedCount > stackCount - 1 - i ? COLORS.strokeActive : COLORS.strokeBase

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
