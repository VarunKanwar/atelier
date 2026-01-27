import { Box } from '@chakra-ui/react'
import {
  PARTICLE_FLOW_DIMENSIONS,
  PARTICLE_FLOW_GEOMETRY,
  PARTICLE_FLOW_ZONES,
  type Particle,
  useParticleFlow,
} from './hooks/useParticleFlow'

const COLORS = {
  particle: '#9CA3AF',
  lensStroke: 'rgba(148, 163, 184, 0.35)',
  lensFill: 'rgba(148, 163, 184, 0.08)',
  lensHighlight: 'rgba(255, 255, 255, 0.35)',
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

const Lens = () => {
  const { width } = PARTICLE_FLOW_DIMENSIONS
  const { conduitStart, conduitEnd } = PARTICLE_FLOW_ZONES
  const { centerY, conduitHalfHeight } = PARTICLE_FLOW_GEOMETRY
  const lensPadding = conduitHalfHeight * 0.3
  const lensX = conduitStart - 4
  const lensWidth = conduitEnd - conduitStart + 8
  const lensY = centerY - conduitHalfHeight - lensPadding
  const lensHeight = conduitHalfHeight * 2 + lensPadding * 2
  const radius = Math.min(6, lensHeight * 0.22)

  return (
    <g>
      <defs>
        <linearGradient id="lens-fill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={COLORS.lensFill} />
          <stop offset="50%" stopColor="rgba(255, 255, 255, 0.06)" />
          <stop offset="100%" stopColor={COLORS.lensFill} />
        </linearGradient>
        <linearGradient id="lens-highlight" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={COLORS.lensHighlight} />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
        </linearGradient>
        <filter
          id="lens-warp"
          x={lensX - 12}
          y={lensY - 12}
          width={lensWidth + 24}
          height={lensHeight + 24}
          filterUnits="userSpaceOnUse"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" seed="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <mask id="lens-inside">
          <rect x="0" y="0" width={width} height="100%" fill="black" />
          <rect x={lensX} y={lensY} width={lensWidth} height={lensHeight} rx={radius} ry={radius} fill="white" />
        </mask>
        <mask id="lens-outside">
          <rect x="0" y="0" width={width} height="100%" fill="white" />
          <rect x={lensX} y={lensY} width={lensWidth} height={lensHeight} rx={radius} ry={radius} fill="black" />
        </mask>
      </defs>

      <rect
        x={lensX}
        y={lensY}
        width={lensWidth}
        height={lensHeight}
        rx={radius}
        ry={radius}
        fill="url(#lens-fill)"
        stroke={COLORS.lensStroke}
        strokeWidth={1}
      />
      <rect
        x={lensX + 1.5}
        y={lensY + 1.5}
        width={lensWidth - 3}
        height={lensHeight * 0.4}
        rx={radius}
        ry={radius}
        fill="url(#lens-highlight)"
      />
    </g>
  )
}

export default function BackpressureVisual() {
  const particles = useParticleFlow()
  const { width, height } = PARTICLE_FLOW_DIMENSIONS
  const { conduitStart, conduitEnd } = PARTICLE_FLOW_ZONES
  const { centerY, conduitHalfHeight } = PARTICLE_FLOW_GEOMETRY
  const lensPadding = conduitHalfHeight * 0.5
  const lensX = conduitStart - 4
  const lensWidth = conduitEnd - conduitStart + 8
  const lensY = centerY - conduitHalfHeight - lensPadding
  const lensHeight = conduitHalfHeight * 2 + lensPadding * 2
  const radius = lensHeight / 2

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
        <g mask="url(#lens-outside)">
          {particles.map(particle => (
            <ParticleElement key={`outer-${particle.id}`} particle={particle} height={height} />
          ))}
        </g>
        <g mask="url(#lens-inside)" filter="url(#lens-warp)">
          {particles.map(particle => (
            <ParticleElement key={`inner-${particle.id}`} particle={particle} height={height} />
          ))}
        </g>
        <Lens />
      </svg>
    </Box>
  )
}
