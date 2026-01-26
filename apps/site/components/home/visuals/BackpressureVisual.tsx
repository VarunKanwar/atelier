import { Box } from '@chakra-ui/react'
import {
  PARTICLE_FLOW_DIMENSIONS,
  PARTICLE_FLOW_ZONES,
  type Particle,
  useParticleFlow,
} from './hooks/useParticleFlow'

const COLORS = {
  particle: '#9CA3AF',
} as const

// Particle visual properties as ratios of height
const SIZE_RATIO_MIN = 0.02 // 2% of height
const SIZE_RATIO_MAX = 0.035 // 3.5% of height
const RADIUS_RATIO_MIN = 0.2 // 20% of size (more square)
const RADIUS_RATIO_MAX = 0.5 // 50% of size (fully round)

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getProgress(x: number): number {
  const { conduitStart, conduitEnd } = PARTICLE_FLOW_ZONES
  if (x < conduitStart) return 0
  if (x > conduitEnd) return 1
  return (x - conduitStart) / (conduitEnd - conduitStart)
}

function ParticleElement({ particle, height }: { particle: Particle; height: number }) {
  const progress = getProgress(particle.x)
  const size = lerp(SIZE_RATIO_MIN, SIZE_RATIO_MAX, progress) * height
  const radiusRatio = lerp(RADIUS_RATIO_MAX, RADIUS_RATIO_MIN, progress) // Circle -> rounded square
  const radius = size * radiusRatio

  return (
    <rect
      x={particle.x - size / 2}
      y={particle.y - size / 2}
      width={size}
      height={size}
      rx={radius}
      ry={radius}
      fill="none"
      stroke={COLORS.particle}
      strokeWidth={1}
      opacity={clamp(particle.opacity, 0, 1)}
    />
  )
}

export default function BackpressureVisual() {
  const particles = useParticleFlow()
  const { width, height } = PARTICLE_FLOW_DIMENSIONS

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
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: '100%', maxWidth: '500px' }}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Particle flow visualization showing backpressure behavior"
        role="img"
      >
        {particles.map(particle => (
          <ParticleElement key={particle.id} particle={particle} height={height} />
        ))}
      </svg>
    </Box>
  )
}
