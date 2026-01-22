import { Box, Text } from '@chakra-ui/react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

const STROKE_WIDTH = 2
const PIPE_COLOR = 'var(--border-subtle)'
const RUNNING_COLOR = '#10b981' // Green-500
const WAITING_COLOR = '#f59e0b' // Amber-500

// Nodes positions (centered)
const NODES = {
  start: { x: 40, y: 150 },
  preprocess: { x: 120, y: 150 },
  split: { x: 160, y: 150 },
  // Top Lane (Thumbnails - Fast)
  thumbStart: { x: 200, y: 80 },
  thumbEnd: { x: 300, y: 80 },
  // Bottom Lane (Inference - Slow)
  inferStart: { x: 200, y: 220 },
  inferEnd: { x: 300, y: 220 },
  // Join
  join: { x: 340, y: 150 },
  end: { x: 380, y: 150 },
}

// SVG Paths for the "Pipes"
// NOTE: Must be single line or clean path data. No comments allowed in d attribute.
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

// Animation Paths (Invisible tracks for motion)
const PATH_FAST_D = `M ${NODES.start.x} ${NODES.start.y} L ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 20} ${NODES.split.y}, ${NODES.thumbStart.x - 20} ${NODES.thumbStart.y}, ${NODES.thumbStart.x} ${NODES.thumbStart.y} L ${NODES.thumbEnd.x} ${NODES.thumbEnd.y} C ${NODES.thumbEnd.x + 20} ${NODES.thumbEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`

const PATH_SLOW_D = `M ${NODES.start.x} ${NODES.start.y} L ${NODES.split.x} ${NODES.split.y} C ${NODES.split.x + 20} ${NODES.split.y}, ${NODES.inferStart.x - 20} ${NODES.inferStart.y}, ${NODES.inferStart.x} ${NODES.inferStart.y} L ${NODES.inferEnd.x} ${NODES.inferEnd.y} C ${NODES.inferEnd.x + 20} ${NODES.inferEnd.y}, ${NODES.join.x - 20} ${NODES.join.y}, ${NODES.join.x} ${NODES.join.y} L ${NODES.end.x} ${NODES.end.y}`

type Particle = {
  id: number
  type: 'fast' | 'slow'
  delay: number
}

const DefineDispatchVisual = () => {
  const [particles, setParticles] = useState<Particle[]>([])

  // Emitter Loop
  useEffect(() => {
    let count = 0
    const interval = setInterval(() => {
      count++
      const type = (Math.random() > 0.5 ? 'fast' : 'slow') as 'fast' | 'slow'
      setParticles(prev => {
        const next = [...prev, { id: count, type, delay: 0 }]
        if (next.length > 8) return next.slice(next.length - 8)
        return next
      })
    }, 1500) // Emit slightly faster
    return () => clearInterval(interval)
  }, [])

  return (
    <Box
      position="relative"
      h={{ base: '260px', md: '280px' }}
      bg="var(--surface-muted)"
      rounded="lg"
      overflow="hidden"
      borderWidth="1px"
      borderColor="var(--border-subtle)"
    >
        {/* Background Grid */}
        <Box
        position="absolute"
        inset={0}
        opacity={0.4}
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148, 163, 184, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.1) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      <svg
        viewBox="0 0 400 300"
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* -- STATIC STRUCTURE -- */}
        
        {/* Pipes */}
        <path
          d={PIPES_D}
          fill="none"
          stroke={PIPE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Nodes */}
        {/* Preprocess */}
        <g transform={`translate(${NODES.preprocess.x}, ${NODES.preprocess.y})`}>
          <rect x="-15" y="-15" width="30" height="30" rx="6" fill="white" stroke={PIPE_COLOR} />
          <text y="35" fontSize="10" textAnchor="middle" fill="gray" style={{ userSelect: 'none' }}>Preprocess</text>
        </g>

        {/* Thumbnail Pool (Fast) */}
        <g transform={`translate(${(NODES.thumbStart.x + NODES.thumbEnd.x) / 2}, ${NODES.thumbStart.y})`}>
             {/* Visualizing 3 parallel slots */}
            <rect x="-40" y="-12" width="80" height="24" rx="4" fill="white" stroke={PIPE_COLOR} strokeDasharray="4 4" />
             <text y="-20" fontSize="10" textAnchor="middle" fill="gray" style={{ userSelect: 'none' }}>Thumbnails (Pool)</text>
        </g>

        {/* Inference Queue (Slow) */}
         <g transform={`translate(${(NODES.inferStart.x + NODES.inferEnd.x) / 2}, ${NODES.inferStart.y})`}>
            {/* Visualizing a single bottleneck slot */}
            <rect x="-15" y="-15" width="30" height="30" rx="6" fill="white" stroke={PIPE_COLOR} />
            <text y="35" fontSize="10" textAnchor="middle" fill="gray" style={{ userSelect: 'none' }}>Inference</text>
        </g>

        {/* Output */}
        <g transform={`translate(${NODES.end.x}, ${NODES.end.y})`}>
             <rect x="-10" y="-10" width="20" height="20" rx="4" fill="white" stroke={PIPE_COLOR} />
        </g>


        {/* -- ANIMATION LAYER -- */}
        
        {particles.map(p => (
            <ParticleShape key={p.id} type={p.type} />
        ))}

      </svg>
      {/* Legend / Overlay Text */}
      <Box position="absolute" bottom={3} left={4}>
        <Text fontSize="xs" color="gray.500">
           Visualization: Concurrent Execution
        </Text>
      </Box>
    </Box>
  )
}

const ParticleShape = ({ type }: { type: 'fast' | 'slow' }) => {
     const isFast = type === 'fast'
     const pathD = isFast ? PATH_FAST_D : PATH_SLOW_D
     
     return (
         <motion.circle
            r={4}
            fill={isFast ? RUNNING_COLOR : WAITING_COLOR}
            initial={{ offsetDistance: '0%' }}
            animate={{ offsetDistance: '100%' }}
            style={{
                offsetPath: `path("${pathD}")`
            }}
            transition={{
                duration: isFast ? 2 : 5, 
                ease: isFast ? "linear" : "easeInOut",
                repeat: 0 // Run once then disappear (recycled by parent state)
            }}
         />
     )
}

export default DefineDispatchVisual
