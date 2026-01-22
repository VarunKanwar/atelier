import { Box } from '@chakra-ui/react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePipelineSimulation, type PipelineItem } from './hooks/usePipelineSimulation'

// --- CONSTANTS ---
const STROKE_WIDTH = 1.5
const PIPE_COLOR = 'rgba(255, 255, 255, 0.1)'
// Colors
const COLOR_START = '#ffffff'
const COLOR_COOL_START = '#22d3ee'
const COLOR_COOL_END = '#818cf8'
const COLOR_WARM_START = '#fbbf24'
const COLOR_WARM_END = '#ef4444'

const NODES = {
  start: { x: 40, y: 150 },
  preprocess: { x: 120, y: 150 },
  split: { x: 160, y: 150 },
  // Top Lane
  thumbStart: { x: 200, y: 80 },
  thumbEnd: { x: 300, y: 80 },
  // Bottom Lane
  inferStart: { x: 200, y: 220 },
  inferEnd: { x: 300, y: 220 },
  // Join
  join: { x: 340, y: 150 },
  end: { x: 380, y: 150 },
}

// Full path strings for offset-path
const PATHS = {
  intro: `M ${NODES.start.x} ${NODES.start.y} L ${NODES.preprocess.x} ${NODES.preprocess.y}`,
  preprocess: `M ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y}`,
  thumb: `M ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 20} ${NODES.split.y}, ${NODES.thumbStart.x - 20} ${NODES.thumbStart.y}, ${NODES.thumbStart.x} ${NODES.thumbStart.y} L ${NODES.thumbEnd.x} ${NODES.thumbEnd.y}`,
  infer: `M ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 20} ${NODES.split.y}, ${NODES.inferStart.x - 20} ${NODES.inferStart.y}, ${NODES.inferStart.x} ${NODES.inferStart.y} L ${NODES.inferEnd.x} ${NODES.inferEnd.y}`,
  thumbExit: `M ${NODES.thumbEnd.x} ${NODES.thumbEnd.y} C ${NODES.thumbEnd.x + 20} ${NODES.thumbEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
  inferExit: `M ${NODES.inferEnd.x} ${NODES.inferEnd.y} C ${NODES.inferEnd.x + 20} ${NODES.inferEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
}

const ALL_PIPES_D = [
    PATHS.intro,
    PATHS.preprocess,
    PATHS.thumb,
    PATHS.infer,
    `M ${NODES.thumbEnd.x} ${NODES.thumbEnd.y} C ${NODES.thumbEnd.x + 20} ${NODES.thumbEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y}`,
    `M ${NODES.inferEnd.x} ${NODES.inferEnd.y} C ${NODES.inferEnd.x + 20} ${NODES.inferEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y}`,
    `M ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`
].join(' ')

export default function DefineDispatchVisual() {
  const { items, inputCount, completedCount, isResetting } = usePipelineSimulation()
  const inferQueue = items.filter(i => i.stage === 'inference-queue')

  return (
    <Box
      position="relative"
      h={{ base: '260px', md: '280px' }}
      bg="#0f172a" 
      rounded="lg"
      overflow="hidden"
      borderWidth="1px"
      borderColor="whiteAlpha.100"
      transition="opacity 0.8s"
      opacity={isResetting ? 0 : 1}
    >
      <svg
        viewBox="0 0 440 300"
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
            <filter id="energy-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>

        <path
          d={ALL_PIPES_D}
          fill="none"
          stroke={PIPE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* --- INPUT STACK --- */}
        <g transform={`translate(${NODES.start.x}, ${NODES.start.y})`}>
            {Array.from({ length: inputCount }).map((_, i) => (
                <rect
                    key={i}
                    x={-10 - i * 0.5}
                    y={-10 - i * 0.5}
                    width={20}
                    height={20}
                    rx={2}
                    fill="white"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth={0.5}
                    opacity={0.6}
                />
            ))}
        </g>

        {/* --- OUTPUT GALLERY --- */}
        <g transform={`translate(${NODES.end.x + 10}, ${NODES.end.y - 40})`}>
           {Array.from({ length: completedCount }).map((_, i) => {
               const row = Math.floor(i / 3)
               const col = i % 3
               return (
                   <motion.rect
                     key={i}
                     initial={{ scale: 0 }}
                     animate={{ scale: 1 }}
                     x={col * 14}
                     y={row * 14}
                     width={10}
                     height={10}
                     rx={1.5}
                     fill="white"
                     opacity={0.5}
                   />
               )
           })}
        </g>

        {/* --- ENERGY PARTICLES --- */}
        <AnimatePresence>
            {items.map(item => {
                const now = Date.now()
                if (item.stage === 'start') return null
                if (item.stage === 'done' && now - item.enteredStageAt > 1000) return null
                return <EnergyParticle key={item.id} item={item} inferQueue={inferQueue} />
            })}
        </AnimatePresence>
      </svg>
    </Box>
  )
}

function EnergyParticle({ item, inferQueue }: { item: PipelineItem, inferQueue: PipelineItem[] }) {
    let pathD = PATHS.intro
    let color = COLOR_START
    let size = 6
    let isStatic = false
    let staticPos = { x: 0, y: 0 }
    let duration = 0.8

    switch (item.stage) {
        case 'preprocess':
            pathD = PATHS.intro
            color = COLOR_START
            duration = 1.2
            break
        case 'inference-queue':
            isStatic = true
            const idx = inferQueue.indexOf(item)
            // Just pile them up at the entrance
            staticPos = { 
                x: (NODES.inferStart.x + NODES.inferEnd.x) / 2 - 30 - (idx * 4),
                y: NODES.inferStart.y 
            }
            color = COLOR_WARM_START
            break
        case 'inference-process':
            pathD = PATHS.infer
            color = COLOR_WARM_END
            size = 8
            duration = 2.0
            break
        case 'thumb-queue':
        case 'thumb-process':
            pathD = PATHS.thumb
            color = item.stage === 'thumb-queue' ? COLOR_COOL_START : COLOR_COOL_END
            duration = 0.6
            break
        case 'done':
            pathD = item.type === 'inference' ? PATHS.inferExit : PATHS.thumbExit
            color = "#ffffff"
            size = 4
            duration = 1.0
            break
    }

    if (isStatic) {
        return (
            <motion.circle
                layoutId={item.id}
                cx={staticPos.x}
                cy={staticPos.y}
                r={size}
                fill={color}
                filter="url(#energy-glow)"
                style={{ mixBlendMode: 'plus-lighter' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            />
        )
    }

    return (
        <motion.circle
            layoutId={item.id}
            r={size}
            fill={color}
            filter="url(#energy-glow)"
            initial={{ offsetDistance: '0%', opacity: 0 }}
            animate={{ offsetDistance: '100%', opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ 
                offsetPath: `path("${pathD}")` ,
                mixBlendMode: 'plus-lighter'
            }}
            transition={{
                duration,
                ease: "linear"
            }}
        />
    )
}
