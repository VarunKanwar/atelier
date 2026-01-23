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
  // Intro: Start -> Preprocess (Ends exactly at the node)
  intro: `M ${NODES.start.x} ${NODES.start.y} L ${NODES.preprocess.x} ${NODES.preprocess.y}`,
  
  // Branch A: Preprocess -> Split -> Thumb Node
  // Overlaps with Infer path until Split point
  thumb: `M ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 40} ${NODES.split.y}, ${NODES.thumbCenter.x - 60} ${NODES.thumbCenter.y}, ${NODES.thumbCenter.x} ${NODES.thumbCenter.y}`,
  
  // Branch B: Preprocess -> Split -> Infer Node
  infer: `M ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 40} ${NODES.split.y}, ${NODES.inferCenter.x - 60} ${NODES.inferCenter.y}, ${NODES.inferCenter.x} ${NODES.inferCenter.y}`,
  
  // MERGED OUTPUTS: Node -> Join -> End
  thumbExit: `M ${NODES.thumbCenter.x} ${NODES.thumbCenter.y} C ${NODES.thumbCenter.x + 60} ${NODES.thumbCenter.y}, ${NODES.join.x - 40} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
  
  inferExit: `M ${NODES.inferCenter.x} ${NODES.inferCenter.y} C ${NODES.inferCenter.x + 60} ${NODES.inferCenter.y}, ${NODES.join.x - 40} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
}

export default function DefineDispatchVisual() {
  const { items, inputCount, completedCount } = usePipelineSimulation()

  // Pre-calculate queues
  const inferQueue = items.filter((i: PipelineItem) => i.stage === 'inference-queue').sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)
  const thumbQueue = items.filter((i: PipelineItem) => i.stage === 'thumb-queue').sort((a: PipelineItem, b: PipelineItem) => a.enteredStageAt - b.enteredStageAt)
  
  const inferenceQueueLen = inferQueue.length
  const isInferenceProcessing = items.some((i: PipelineItem) => i.stage === 'inference-process')
  const isStressed = inferenceQueueLen > 1

  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      minH={{ base: '260px', md: '300px' }} // Ensure enough height
      bg="transparent"
      rounded="lg"
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <svg
        viewBox="0 0 500 300" // Expanded view to prevents clipping (Top node y=54, Bottom node y=246)
        style={{ width: '100%', height: '100%', maxWidth: '600px' }} 
        preserveAspectRatio="xMidYMid meet" 
      >
        <defs>
           <filter id="glow-basic" x="-50%" y="-50%" width="200%" height="200%">
             <feGaussianBlur stdDeviation="1.5" result="blur" />
             <feComposite in="SourceGraphic" in2="blur" operator="over" />
           </filter>
        </defs>

        {/* --- DAG EDGES (Static Pipes) --- */}
        <g stroke={PIPE_COLOR} fill="none" strokeWidth={STROKE_WIDTH_BASE} strokeLinecap="round">
          {/* We draw specific segments to form the visual tree, avoiding overlaps if possible */}
          <path d={PATHS.intro} />
          <path d={PATHS.thumb} />
          <path d={PATHS.infer} />
          {/* Draw exit paths - simple version just draws the curves */}
          <path d={PATHS.thumbExit} />
          <path d={PATHS.inferExit} />
        </g>
        
        {/* --- PACKETS --- */}
        <AnimatePresence initial={false}>
          {items.map((item: PipelineItem) => {
             let queueIndex = -1
             if (item.stage === 'inference-queue') {
                queueIndex = inferQueue.findIndex((i: PipelineItem) => i.id === item.id)
             } else if (item.stage === 'thumb-queue') {
                queueIndex = thumbQueue.findIndex((i: PipelineItem) => i.id === item.id)
             }
             
             return <Packet key={`${item.id}-${item.stage}`} item={item} queueIndex={queueIndex} />
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
          <text fontSize="9" fill="gray" x="0" y="-8">Gallery</text>
          <rect width={24} height={24} rx="4" fill="none" stroke={PIPE_COLOR_DARK} />
          <TextOverlay x={12} y={15} text={String(completedCount)} color="#333" />
        </g>
      </svg>
    </Box>
  )
}

function Packet({ item, queueIndex }: { item: PipelineItem, queueIndex: number }) {
  // AG: Why do we need this?
  const isThumb = item.type === 'thumb'
  
  // Calculate Target State based on Item Stage
  let path = ''
  let finalOffset = '100%'
  let startOffset = '0%' 
  let duration = 0
  let color = '#333'
  let opacity = 1
  let width = 12 

  if (item.stage === 'preprocess') {
     path = PATHS.intro 
     duration = PREPROCESS_DURATION / 1000
     color = '#64748b' 
     startOffset = '0%'
     finalOffset = '100%'
  }
  else if (item.stage === 'thumb-queue') {
     path = PATHS.thumb
     color = '#8b5cf6'
     startOffset = '0%'
     // Stack at end of the NEW longer path (starts at Preprocess)
     // Math: 95% - (index * 3%)
     finalOffset = `${Math.max(0, 95 - (queueIndex * 3))}%`
     // Slightly overlap to create beam
     width = 12
     duration = 0.5
  }
  else if (item.stage === 'thumb-process') {
     path = PATHS.thumb
     color = '#3b82f6'
     // Stay at node (which is now at 95% of this longer path)
     startOffset = '95%' 
     finalOffset = '95%' 
     duration = THUMB_DURATION / 1000
  }
  else if (item.stage === 'inference-queue') {
     path = PATHS.infer
     color = '#facc15' 
     startOffset = '0%'
     finalOffset = `${Math.max(0, 95 - (queueIndex * 3))}%`
     duration = 0.5
  }
  else if (item.stage === 'inference-process') {
     path = PATHS.infer
     color = '#ef4444' 
     startOffset = '95%'
     finalOffset = '95%' 
     duration = INFERENCE_DURATION / 1000
  }
  else if (item.stage === 'done') {
     path = isThumb ? PATHS.thumbExit : PATHS.inferExit
     color = isThumb ? '#3b82f6' : '#ef4444' 
     startOffset = '0%'
     finalOffset = '100%'
     duration = 0.8 
  }

  const isProcess = item.stage.includes('process')

  return (
    <motion.rect
      layoutId={item.id} 
      initial={{ offsetDistance: startOffset, opacity: 1 }} 
      animate={{ 
        offsetDistance: finalOffset,
        fill: color,
        width: width, 
        opacity: isProcess ? [1, 0.5, 1] : 1,
      }}
      style={{
         offsetPath: `path("${path}")`,
         offsetRotate: 'auto',
         height: 3,
         rx: 1.5,
      }}
      transition={{ 
        duration: duration, 
        ease: 'linear', 
        opacity: { repeat: isProcess ? Infinity : 0, duration: 0.5 }
      }}
      // Fast fade out to prevent accumulation
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    />
  )
}

function MachineNode({ x, y, label, isActive, isStressed, variant, queueLen = 0 }: { x: number, y: number, label: string, isActive: boolean, isStressed?: boolean, variant?: 'pool' | 'singleton', queueLen?: number }) {
  // Color Logic:
  // Base: #fff (White)
  // Moderate Queue: #facc15 (Yellow/Orange)
  // Heavy Queue: #ef4444 (Red)
  
  let fillColor = '#fff'
  let strokeColor = '#CBD5E1'

  if (variant === 'singleton') {
      if (queueLen > 4) fillColor = '#fecaca' // Light Red
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
