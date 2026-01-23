import { Box } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  EXIT_DURATION,
  INFERENCE_DURATION,
  INFERENCE_WORKERS,
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
const PACKET_SEGMENT = 12
const WORKER_STEP_MS = 220

const NODES = {
  start: { x: 50, y: 150 },
  preprocess: { x: 130, y: 150 },
  split: { x: 190, y: 150 },
  thumbCenter: { x: 300, y: 70 },
  inferCenter: { x: 300, y: 230 },
  join: { x: 380, y: 150 },
  end: { x: 440, y: 150 },
}

// Motion paths used by packets as they move through the pipeline.
const PATHS = {
  // Entry: Start -> Preprocess
  intro: `M ${NODES.start.x} ${NODES.start.y} L ${NODES.preprocess.x} ${NODES.preprocess.y}`,

  // Branch A: Preprocess -> Split -> Thumbnails
  thumb: `M ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 40} ${NODES.split.y}, ${NODES.thumbCenter.x - 60} ${NODES.thumbCenter.y}, ${NODES.thumbCenter.x} ${NODES.thumbCenter.y}`,

  // Branch B: Preprocess -> Split -> Inference
  infer: `M ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 40} ${NODES.split.y}, ${NODES.inferCenter.x - 60} ${NODES.inferCenter.y}, ${NODES.inferCenter.x} ${NODES.inferCenter.y}`,

  // Merge: branch output -> Join -> End
  thumbExit: `M ${NODES.thumbCenter.x} ${NODES.thumbCenter.y} C ${NODES.thumbCenter.x + 60} ${NODES.thumbCenter.y}, ${NODES.join.x - 40} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,

  inferExit: `M ${NODES.inferCenter.x} ${NODES.inferCenter.y} C ${NODES.inferCenter.x + 60} ${NODES.inferCenter.y}, ${NODES.join.x - 40} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
}

export default function DefineDispatchVisual() {
  const { items, inputCount, completedCount, cycle } = usePipelineSimulation()

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
  const isStressed = inferenceQueueLen > 1

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
          <filter id="glow-basic" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
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

              return <Packet key={`${item.id}-${item.stage}`} item={item} queueIndex={queueIndex} />
            })}
          </AnimatePresence>

          {/* --- NODES --- */}
          <MachineNode
            x={NODES.preprocess.x}
            y={NODES.preprocess.y}
            label="Preprocess"
            isActive={preprocessActiveDisplay > 0}
            activeWorkers={preprocessActiveDisplay}
            maxWorkers={PREPROCESS_WORKERS}
          />
          <MachineNode
            x={NODES.thumbCenter.x}
            y={NODES.thumbCenter.y}
            label="Thumbnails"
            isActive={thumbActiveDisplay > 0}
            activeWorkers={thumbActiveDisplay}
            maxWorkers={THUMB_WORKERS}
            variant="pool"
          />
          <MachineNode
            x={NODES.inferCenter.x}
            y={NODES.inferCenter.y}
            label="Inference"
            isActive={isInferenceProcessing}
            activeWorkers={inferenceActiveDisplay}
            maxWorkers={INFERENCE_WORKERS}
            isStressed={isStressed}
            variant="singleton"
            queueLen={inferenceQueueLen}
          />

          {/* --- INPUT --- */}
          <g transform={`translate(${NODES.start.x}, ${NODES.start.y})`}>
            <text fontSize="10" fill="#64748b" x="0" y="-25" textAnchor="middle">
              Album
            </text>
            {Array.from({ length: Math.min(inputCount, 6) }).map((_, i) => (
              <motion.rect
                key={i}
                x={-i * 0.5}
                y={-i * 2}
                width={20}
                height={20}
                rx={2}
                fill="#fff"
                stroke="#94a3b8"
                strokeWidth={1}
                initial={false}
                animate={{ x: -i * 0.5, y: -i * 2, opacity: 1 }}
                exit={{ opacity: 0, x: 20 }}
              />
            ))}
          </g>

          {/* --- OUTPUT --- */}
          <g transform={`translate(${NODES.end.x + 10}, ${NODES.end.y - 12})`}>
            <text fontSize="9" fill="gray" x="0" y="-8">
              Gallery
            </text>
            <rect width={24} height={24} rx="4" fill="none" stroke={PIPE_COLOR_DARK} />
            <TextOverlay x={12} y={15} text={String(completedCount)} color="#333" />
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

function Packet({ item, queueIndex }: { item: PipelineItem; queueIndex: number }) {
  // Used to select the correct exit path once the item completes.
  const isThumb = item.type === 'thumb'

  // Stage → motion recipe (path, offsets, duration, accent).
  let path = ''
  let finalOffset = '100%'
  let startOffset = '0%'
  let duration = 0
  let accent = '#94a3b8'

  if (item.stage === 'preprocess-queue') {
    path = PATHS.intro
    duration = TRAVEL_DURATION / 1000
    accent = '#38bdf8'
    startOffset = '0%'
    // Stack queue items by backing up along the path.
    finalOffset = `${Math.max(0, 95 - queueIndex * 3)}%`
  } else if (item.stage === 'preprocess') {
    path = PATHS.intro
    duration = PREPROCESS_DURATION / 1000
    accent = '#38bdf8'
    // Hold at the worker node while processing.
    startOffset = '95%'
    finalOffset = '95%'
  } else if (item.stage === 'thumb-queue') {
    path = PATHS.thumb
    accent = '#a78bfa'
    startOffset = '0%'
    // Stack queue items by backing up along the path.
    finalOffset = `${Math.max(0, 95 - queueIndex * 3)}%`
    duration = TRAVEL_DURATION / 1000
  } else if (item.stage === 'thumb-process') {
    path = PATHS.thumb
    accent = '#60a5fa'
    // Hold at the worker node while processing.
    startOffset = '95%'
    finalOffset = '95%'
    duration = THUMB_DURATION / 1000
  } else if (item.stage === 'inference-queue') {
    path = PATHS.infer
    accent = '#fbbf24'
    startOffset = '0%'
    // Stack queue items by backing up along the path.
    finalOffset = `${Math.max(0, 95 - queueIndex * 3)}%`
    duration = TRAVEL_DURATION / 1000
  } else if (item.stage === 'inference-process') {
    path = PATHS.infer
    accent = '#f43f5e'
    // Hold at the worker node while processing.
    startOffset = '95%'
    finalOffset = '95%'
    duration = INFERENCE_DURATION / 1000
  } else if (item.stage === 'done') {
    path = isThumb ? PATHS.thumbExit : PATHS.inferExit
    accent = isThumb ? '#60a5fa' : '#f43f5e'
    startOffset = '0%'
    finalOffset = '100%'
    duration = EXIT_DURATION / 1000
  }

  const isProcess = item.stage.includes('process')
  const startPercent = Number.parseFloat(startOffset)
  const endPercent = Number.parseFloat(finalOffset)
  const startDash = -startPercent
  const endDash = -endPercent
  const dashArray = `${PACKET_SEGMENT} ${100 - PACKET_SEGMENT}`

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
  label,
  isActive,
  isStressed: _isStressed,
  variant,
  activeWorkers = 0,
  maxWorkers = activeWorkers,
  queueLen = 0,
}: {
  x: number
  y: number
  label: string
  isActive: boolean
  isStressed?: boolean
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
      {/* Node body + label + optional activity pulse */}
      <motion.rect
        x="-24"
        y="-16"
        width="48"
        height="32"
        rx="8"
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
