import { Box } from '@chakra-ui/react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePipelineSimulation, type PipelineItem, PREPROCESS_DURATION, THUMB_DURATION, INFERENCE_DURATION } from './hooks/usePipelineSimulation'

// --- VISUAL CONSTANTS ---
const STROKE_WIDTH_BASE = 2
const PIPE_COLOR = '#E2E8F0' // Visible light gray for structure
const PIPE_COLOR_DARK = '#CBD5E1' // Slightly darker for contrast if needed

const NODES = {
  start: { x: 50, y: 150 },
  preprocess: { x: 130, y: 150 },
  split: { x: 190, y: 150 },
  thumbCenter: { x: 300, y: 70 },   // Moved out slightly for better curve
  inferCenter: { x: 300, y: 230 },  // Moved out slightly
  join: { x: 380, y: 150 },
  end: { x: 440, y: 150 },
}

// SVG Path definitions
const PATHS = {
  // Combined Start -> Preprocess -> Split for the initial entry animation "intro"
  intro: `M ${NODES.start.x} ${NODES.start.y} L ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y}`,
  
  // Split -> Thumb Node
  thumb: `M ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 40} ${NODES.split.y}, ${NODES.thumbCenter.x - 60} ${NODES.thumbCenter.y}, ${NODES.thumbCenter.x} ${NODES.thumbCenter.y}`,
  
  // Split -> Infer Node
  infer: `M ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 40} ${NODES.split.y}, ${NODES.inferCenter.x - 60} ${NODES.inferCenter.y}, ${NODES.inferCenter.x} ${NODES.inferCenter.y}`,
  
  // Thumb Node -> Join
  thumbOut: `M ${NODES.thumbCenter.x} ${NODES.thumbCenter.y} C ${NODES.thumbCenter.x + 60} ${NODES.thumbCenter.y}, ${NODES.join.x - 40} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y}`,
  
  // Infer Node -> Join
  inferOut: `M ${NODES.inferCenter.x} ${NODES.inferCenter.y} C ${NODES.inferCenter.x + 60} ${NODES.inferCenter.y}, ${NODES.join.x - 40} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y}`,
  
  outro: `M ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
}

export default function DefineDispatchVisual() {
  const { items, inputCount, completedCount } = usePipelineSimulation()

  // Pre-calculate queues for indexing
  const inferQueue = items.filter((i: PipelineItem) => i.stage === 'inference-queue').sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)
  const thumbQueue = items.filter((i: PipelineItem) => i.stage === 'thumb-queue').sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)
  
  const inferenceQueueLen = inferQueue.length
  const isInferenceProcessing = items.some((i: PipelineItem) => i.stage === 'inference-process')
  const isStressed = inferenceQueueLen > 1

  return (
    <Box
      position="relative"
      // h={{ base: '260px', md: '280px' }}
      bg="transparent"
      rounded="lg"
      overflow="hidden"
    >
      <svg
        viewBox="0 0 460 300"
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
           {/* Streaks need gradients to look like 'luminous energy' */}
           <linearGradient id="trace-cool" gradientUnits="objectBoundingBox">
             <stop offset="0%" stopColor="#fff" stopOpacity="0" />
             <stop offset="100%" stopColor="#3b82f6" />
           </linearGradient>
           <linearGradient id="trace-warm" gradientUnits="objectBoundingBox">
             <stop offset="0%" stopColor="#fff" stopOpacity="0" />
             <stop offset="100%" stopColor="#ef4444" />
           </linearGradient>

           {/* Glows */}
           <filter id="glow-basic" x="-50%" y="-50%" width="200%" height="200%">
             <feGaussianBlur stdDeviation="1.5" result="blur" />
             <feComposite in="SourceGraphic" in2="blur" operator="over" />
           </filter>
        </defs>

        {/* --- DAG EDGES (Static Pipes) --- */}
        <g stroke={PIPE_COLOR} fill="none" strokeWidth={STROKE_WIDTH_BASE} strokeLinecap="round">
          {Object.values(PATHS).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        
        {/* --- PACKETS --- */}
        <AnimatePresence>
          {items.map((item: PipelineItem) => {
             // Calculate queue index
             let queueIndex = -1
             if (item.stage === 'inference-queue') {
                queueIndex = inferQueue.findIndex((i: PipelineItem) => i.id === item.id)
             } else if (item.stage === 'thumb-queue') {
                queueIndex = thumbQueue.findIndex((i: PipelineItem) => i.id === item.id)
             }
             
             return <Packet key={item.id} item={item} queueIndex={queueIndex} />
          })}
        </AnimatePresence>

        {/* --- NODES --- */}
        <MachineNode x={NODES.preprocess.x} y={NODES.preprocess.y} label="Preprocess" isActive={items.some((i: PipelineItem) => i.stage === 'preprocess')} />
        <MachineNode x={NODES.thumbCenter.x} y={NODES.thumbCenter.y} label="Thumbnails" isActive={items.some((i: PipelineItem) => i.stage === 'thumb-process')} variant="pool" />
        <MachineNode x={NODES.inferCenter.x} y={NODES.inferCenter.y} label="Inference" isActive={isInferenceProcessing} isStressed={isStressed} variant="singleton" queueLen={inferenceQueueLen} />

        {/* --- INPUT --- */}
        <g transform={`translate(${NODES.start.x}, ${NODES.start.y})`}>
          <text fontSize="10" fill="#64748b" x="0" y="-25" textAnchor="middle">Album</text>
          {Array.from({ length: Math.min(inputCount, 6) }).map((_, i) => (
             <motion.rect
                key={i}
                x={-i * 0.5} // Minimal horizontal shift
                y={-i * 2} // Vertical stack
                width={20}
                height={20}
                rx={2}
                fill="#fff"
                stroke="#94a3b8"
                strokeWidth={1}
                initial={false}
                animate={{ x: -i * 0.5, y: -i * 2, opacity: 1 }}
                exit={{ opacity: 0, x: 20 }} // Fly out to right upon depletion
             />
          ))}
        </g>

        {/* --- OUTPUT --- */}
        <g transform={`translate(${NODES.end.x + 10}, ${NODES.end.y - 12})`}>
          <text fontSize="9" fill="gray" x="0" y="-8">Gallery</text>
          <rect width={24} height={24} rx="4" fill="none" stroke={PIPE_COLOR_DARK} />
          <TextOverlay x={12} y={15} text={String(completedCount)} color="#333" />
        </g>
      </svg>
    </Box>
  )
}

function Packet({ item, queueIndex }: { item: PipelineItem, queueIndex: number }) {
  const isThumb = item.type === 'thumb'
  
  let color = '#333'
  let path = ''
  let duration = 0
  let targetOffset = '100%'
  let initialOffset = '0%'
  let width = 12 // "Streak" length
  let height = 3  // Thickness
  
  // State Mapping
  if (item.stage === 'preprocess') {
     path = PATHS.intro // Travels from Start -> Preprocess -> Split
     duration = PREPROCESS_DURATION / 1000
     color = '#64748b' // Slate
  }
  else if (item.stage === 'thumb-queue') {
    path = PATHS.thumb
    duration = 0.5 
    color = '#8b5cf6' 
    // Stack at end: 100% - (index * 8%)
    // Clamp to ensure they don't go backwards past 0
    const offsetVal = Math.max(0, 95 - (queueIndex * 8))
    targetOffset = `${offsetVal}%`
  }
  else if (item.stage === 'thumb-process') {
    // For process, we want to look like we are "in" the node or moving through it?
    // Let's pulse at the node location (end of input path)
    path = PATHS.thumb
    initialOffset = '95%'
    targetOffset = '100%'
    duration = THUMB_DURATION / 1000
    color = '#3b82f6'
    // Alternatively, jump to output path? 
    // Simpler: Process = sit at node. 
  }
  else if (item.stage === 'inference-queue') {
    path = PATHS.infer
    duration = 0.5 
    color = '#facc15'
    // Stack at end of input path
    const offsetVal = Math.max(0, 95 - (queueIndex * 8))
    targetOffset = `${offsetVal}%`
  }
  else if (item.stage === 'inference-process') {
    path = PATHS.infer
    initialOffset = '95%'
    targetOffset = '100%'
    duration = INFERENCE_DURATION / 1000
    color = '#ef4444' 
  }
  else if (item.stage === 'done') {
     path = isThumb ? PATHS.thumbOut : PATHS.inferOut
     duration = 0.4
     color = isThumb ? '#3b82f6' : '#ef4444'
  }
  
  const isQueued = item.stage.includes('queue')
  const isProcess = item.stage.includes('process')

  // Render a Rect that is rotated along the path
  const style: React.CSSProperties = {
     offsetPath: `path("${path}")`,
     offsetDistance: initialOffset,
     offsetRotate: 'auto', // Follow curvature
  }
  
  // If processing, maybe we just pulse a circle at the node instead of a streak?
  // User asked for "Sleek luminous line". 
  
  return (
    <motion.rect
      width={width}
      height={height}
      rx={1.5}
      fill={color}
      style={style}
      // Add glow filter
      filter="url(#glow-basic)"
      initial={{ offsetDistance: initialOffset, opacity: 0 }}
      animate={{ 
        offsetDistance: targetOffset,
        opacity: isProcess ? [1, 0.5, 1] : 1, // Pulse if processing
        width: isQueued ? 4 : 12, // Shorten if in queue (dots)
      }}
      transition={{ 
        duration: isQueued ? 0.3 : duration, 
        ease: isQueued ? 'easeOut' : 'linear',
        opacity: { repeat: isProcess ? Infinity : 0, duration: 0.5 }
      }}
      exit={{ opacity: 0, scale: 0 }}
    />
  )
}

function MachineNode({ x, y, label, isActive, isStressed, variant, queueLen = 0 }: { x: number, y: number, label: string, isActive: boolean, isStressed?: boolean, variant?: 'pool' | 'singleton', queueLen?: number }) {
  // Color Logic:
  // Base: #fff (White)
  // Moderate Queue: #facc15 (Yellow/Orange)
  // Heavy Queue: #ef4444 (Red)
  
  // Create a dynamic fill color based on queue length for singleton workers
  // Pool workers generally don't show this stress in the same way for this viz
  let fillColor = '#fff'
  let strokeColor = '#CBD5E1'

  if (variant === 'singleton') {
      // Interpolate from White to Red as queue goes from 0 to 5+
      // Simple discrete steps for clarity or could be smooth
      if (queueLen > 4) fillColor = '#fecaca' // Light Red
      else if (queueLen > 2) fillColor = '#fef08a' // Light Yellow
      
      // Border color gets more intense
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
       {/* Node Body */}
       <motion.rect 
          x="-24" y="-16" 
          width="48" height="32" 
          rx="8" 
          fill={fillColor}
          stroke={strokeColor} 
          strokeWidth={isActive || queueLen > 0 ? 2 : 1.5} 
          animate={{ fill: fillColor, stroke: strokeColor }}
          transition={{ duration: 0.3 }}
       />
       
       {/* Label */}
       <text y="40" fontSize="10" textAnchor="middle" fill="#64748b" fontWeight="medium">{label}</text>
       
       {/* Active Indicator (Pulse) inside - only if actually processing */}
       {isActive && (
          <motion.circle
            r={4}
            fill={variant === 'singleton' && queueLen > 2 ? '#ef4444' : (variant === 'pool' ? '#8b5cf6' : '#3b82f6')}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ repeat: Infinity, duration: 1 }}
          />
       )}
    </g>
  )
}

function TextOverlay({ x, y, text, color }: { x: number, y: number, text: string, color: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fill={color} fontSize="11" fontWeight="bold" style={{ userSelect: 'none' }}>
      {text}
    </text>
  )
}
