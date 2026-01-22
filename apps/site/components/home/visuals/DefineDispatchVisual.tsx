import { Box, Text } from '@chakra-ui/react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePipelineSimulation, type PipelineItem } from './hooks/usePipelineSimulation'

// --- CONSTANTS ---
const STROKE_WIDTH = 1.5
const PIPE_COLOR = 'rgba(255, 255, 255, 0.1)' // Very subtle pipe
// Luminous Palette
const COLOR_START = '#ffffff'
const COLOR_COOL_START = '#22d3ee' // Cyan-400
const COLOR_COOL_END = '#818cf8'   // Indigo-400
const COLOR_WARM_START = '#fbbf24' // Amber-400
const COLOR_WARM_END = '#ef4444'   // Red-500
const COLOR_DONE = '#ffffff'       // White again

const NODES = {
  start: { x: 50, y: 150 },
  preprocess: { x: 130, y: 150 },
  split: { x: 170, y: 150 },
  // Top Lane (Thumbnails)
  thumbStart: { x: 210, y: 80 },
  thumbEnd: { x: 310, y: 80 },
  // Bottom Lane (Inference)
  inferStart: { x: 210, y: 220 },
  inferEnd: { x: 310, y: 220 },
  // Join
  join: { x: 350, y: 150 },
  end: { x: 390, y: 150 },
}

// SVG Paths
const PIPES_D = [
  `M ${NODES.start.x} ${NODES.start.y} L ${NODES.preprocess.x} ${NODES.preprocess.y}`,
  `M ${NODES.preprocess.x} ${NODES.preprocess.y} L ${NODES.split.x} ${NODES.split.y}`,
  // Top Branch
  `M ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 20} ${NODES.split.y}, ${NODES.thumbStart.x - 20} ${NODES.thumbStart.y}, ${NODES.thumbStart.x} ${NODES.thumbStart.y}`,
  `L ${NODES.thumbEnd.x} ${NODES.thumbEnd.y}`,
  `C ${NODES.thumbEnd.x + 20} ${NODES.thumbEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y}`,
  // Bottom Branch
  `M ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 20} ${NODES.split.y}, ${NODES.inferStart.x - 20} ${NODES.inferStart.y}, ${NODES.inferStart.x} ${NODES.inferStart.y}`,
  `L ${NODES.inferEnd.x} ${NODES.inferEnd.y}`,
  `C ${NODES.inferEnd.x + 20} ${NODES.inferEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y}`,
  // Exit
  `M ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`,
].join(' ')

export default function DefineDispatchVisual() {
  const { items, inputCount, completedCount } = usePipelineSimulation()

  // Filter queues to calculate positions
  const inferQueue = items.filter(i => i.stage === 'inference-queue')
  const thumbQueue = items.filter(i => i.stage === 'thumb-queue')

  return (
    <Box
      position="relative"
      h={{ base: '260px', md: '280px' }}
      // Use a dark backdrop for the luminous effect to pop?
      // Or keep light theme but use dark containers? 
      // The current theme is light. A "Luminous" effect works best on dark.
      // But we must respect the site theme. We'll use additive blending (mix-blend-mode) which helps even on light.
      // Actually, for "Energy" on light mode, we want bright, saturated colors.
      bg="#0f172a" // Slate-900: Force dark mode for this visualization to make it pop?
      // Alternatively, use a deep gradient
      style={{
        background: 'linear-gradient(to bottom right, #0f172a, #1e293b)'
      }}
      rounded="lg"
      overflow="hidden"
      borderWidth="1px"
      borderColor="whiteAlpha.100"
    >
      {/* Background Grid */}
      <Box
        position="absolute"
        inset={0}
        opacity={0.2}
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      <svg
        viewBox="0 0 440 300"
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
            {/* Soft Glow Filter */}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
            
            {/* Gradients for Paths */}
            <linearGradient id="grad-cool" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={COLOR_COOL_START} />
                <stop offset="100%" stopColor={COLOR_COOL_END} />
            </linearGradient>
            <linearGradient id="grad-warm" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={COLOR_WARM_START} />
                <stop offset="100%" stopColor={COLOR_WARM_END} />
            </linearGradient>
        </defs>

        <path
          d={PIPES_D}
          fill="none"
          stroke={PIPE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* --- STATIC NODES (Subtle Outlines) --- */}
        <NodeBox x={NODES.preprocess.x} y={NODES.preprocess.y} label="Preprocess" />
        <NodeBox x={(NODES.thumbStart.x + NODES.thumbEnd.x) / 2} y={NODES.thumbStart.y} label="Thumbnails" />
        <NodeBox x={(NODES.inferStart.x + NODES.inferEnd.x) / 2} y={NODES.inferStart.y} label="Inference" />

        {/* --- INPUT STACK (Energy Source) --- */}
        <g transform={`translate(${NODES.start.x}, ${NODES.start.y})`}>
             <text y="35" fontSize="10" textAnchor="middle" fill="rgba(255,255,255,0.5)">Input</text>
             {/* Render a pulsating core for the source */}
             <motion.circle 
                cx={0} cy={0} r={12} 
                fill="white" 
                filter="url(#glow)" 
                opacity={inputCount > 0 ? 0.8 : 0.2}
                animate={{ scale: inputCount > 0 ? [1, 1.1, 1] : 1 }}
                transition={{ duration: 2, repeat: Infinity }}
             />
             <text y="4" fontSize="10" textAnchor="middle" fill="#0f172a" fontWeight="bold">
                 {inputCount}
             </text>
        </g>

        {/* --- OUTPUT GALLERY (Cooling Down) --- */}
        <g transform={`translate(${NODES.end.x + 20}, ${NODES.end.y - 40})`}>
           <rect x="-10" y="0" width="50" height="80" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" />
           <text y="-10" fontSize="10" textAnchor="start" fill="rgba(255,255,255,0.5)">Gallery</text>
           {Array.from({ length: Math.min(completedCount, 12) }).map((_, i) => {
               const row = Math.floor(i / 3)
               const col = i % 3
               return (
                   <motion.rect
                     key={i}
                     initial={{ scale: 0, opacity: 0 }}
                     animate={{ scale: 1, opacity: 0.8 }}
                     x={-2 + col * 14}
                     y={8 + row * 14}
                     width={10}
                     height={10}
                     rx={2}
                     fill="white"
                   />
               )
           })}
        </g>

        {/* --- DYNAMIC PARTICLES --- */}
        <AnimatePresence>
            {items.map(item => {
                if (item.stage === 'start') return null
                
                // For 'done' items, we only show them briefly as they travel to the gallery
                const isDone = item.stage === 'done'
                const now = Date.now()
                if (isDone && (now - item.enteredStageAt > 1000)) return null

                let target = { x: 0, y: 0 }
                let color = COLOR_START
                let size = 6
                let blur = "url(#glow)"
                
                // --- POSITION & COLOR LOGIC ---
                if (item.stage === 'preprocess') {
                    // Moving to Preprocess
                     target = NODES.preprocess
                     color = COLOR_START
                } 
                else if (item.stage === 'inference-queue') {
                   // Queue Cloud: Random jitter around the entry point
                   const index = inferQueue.indexOf(item)
                   // We use the ID to create a deterministic "random" position so it doesn't jitter frame-by-frame
                   // unless we want it to "buzz". Let's settle for stable stacking first.
                   // "Pulsating Mass": Just cluster them tight?
                   
                   const nodeX = (NODES.inferStart.x + NODES.inferEnd.x) / 2
                   // Stack to the LEFT of the node
                   target = { 
                       x: nodeX - 30 - (index * 4), // Tighter overlap
                       y: NODES.inferStart.y 
                   }
                   color = COLOR_WARM_START
                }
                else if (item.stage === 'thumb-queue') {
                   const index = thumbQueue.indexOf(item)
                   const nodeX = (NODES.thumbStart.x + NODES.thumbEnd.x) / 2
                   target = { 
                       x: nodeX - 30 - (index * 4), 
                       y: NODES.thumbStart.y 
                   }
                   color = COLOR_COOL_START
                }
                else if (item.stage === 'inference-process') {
                    // Inside the machine
                    // Animate through the node?
                    target = { x: (NODES.inferStart.x + NODES.inferEnd.x) / 2 + 20, y: NODES.inferStart.y }
                    color = COLOR_WARM_END
                    size = 8
                }
                else if (item.stage === 'thumb-process') {
                     target = { x: (NODES.thumbStart.x + NODES.thumbEnd.x) / 2 + 20, y: NODES.thumbStart.y }
                     color = COLOR_COOL_END
                     size = 7
                }
                else if (item.stage === 'done') {
                    // Final transition to gallery
                    target = { x: NODES.end.x + 20, y: NODES.end.y }
                    color = COLOR_DONE
                    size = 4
                    blur = "none" // Sharpens up as it hits the gallery
                }

                return (
                    <motion.circle
                        key={item.id}
                        layoutId={item.id}
                        animate={{ 
                            cx: target.x, 
                            cy: target.y,
                            fill: color
                        }}
                        // Fluid Transition
                        transition={{ 
                            type: 'spring', 
                            stiffness: 40, // Very soft spring --> "Water/Fluid" feel
                            damping: 15,
                            mass: 1
                        }}
                        initial={false} // Don't animate on mount (handled by layoutId mostly)
                        r={size}
                        filter={blur}
                        style={{ mixBlendMode: 'screen' }} // Additive blending for "Light"
                    />
                )
            })}
        </AnimatePresence>

      </svg>
      {/* Legend */}
      <Box position="absolute" bottom={3} left={4} pointerEvents="none">
        <Text fontSize="xs" color="rgba(255,255,255,0.4)">
           Visualization: Concurrent Execution
        </Text>
      </Box>
    </Box>
  )
}

const NodeBox = ({ x, y, label }: { x: number; y: number; label: string }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Glassmorphism Node */}
    <rect x="-20" y="-15" width="40" height="30" rx="6" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" />
    <text y="35" fontSize="10" textAnchor="middle" fill="rgba(255,255,255,0.5)" style={{ userSelect: 'none' }}>{label}</text>
  </g>
)
