import { Box } from '@chakra-ui/react'
import { useId } from 'react'
import {
  PARTICLE_FLOW_DIMENSIONS,
  PARTICLE_FLOW_GEOMETRY,
  PARTICLE_FLOW_ZONES,
  type Particle,
  useParticleFlow,
} from './hooks/useParticleFlow'

const COLORS = {
  particle: 'var(--stroke-muted)',
  lensStroke: 'var(--lens-stroke)',
  lensFill: 'var(--lens-fill)',
  lensHighlight: 'var(--lens-highlight)',
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

const Lens = ({ fillId, highlightId }: { fillId: string; highlightId: string }) => {
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
      <rect
        x={lensX}
        y={lensY}
        width={lensWidth}
        height={lensHeight}
        rx={radius}
        ry={radius}
        fill={`url(#${fillId})`}
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
        fill={`url(#${highlightId})`}
      />
    </g>
  )
}

export default function BackpressureVisual() {
  const particles = useParticleFlow()
  const instanceId = useId().replace(/:/g, '')
  const { width, height } = PARTICLE_FLOW_DIMENSIONS
  const { conduitStart, conduitEnd } = PARTICLE_FLOW_ZONES
  const { centerY, conduitHalfHeight } = PARTICLE_FLOW_GEOMETRY
  const lensPadding = conduitHalfHeight * 0.5
  const lensX = conduitStart - 4
  const lensWidth = conduitEnd - conduitStart + 8
  const lensY = centerY - conduitHalfHeight - lensPadding
  const lensHeight = conduitHalfHeight * 2 + lensPadding * 2
  const radius = lensHeight / 2
  const particleLayerId = `${instanceId}-particles`
  const lensFillId = `${instanceId}-lens-fill`
  const lensHighlightId = `${instanceId}-lens-highlight`
  const lensWarpId = `${instanceId}-lens-warp`
  const lensInsideId = `${instanceId}-lens-inside`
  const lensOutsideId = `${instanceId}-lens-outside`

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
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Particle flow visualization showing backpressure behavior"
        role="img"
      >
        <defs>
          <linearGradient id={lensFillId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={COLORS.lensFill} />
            <stop offset="50%" stopColor="rgba(255, 255, 255, 0.06)" />
            <stop offset="100%" stopColor={COLORS.lensFill} />
          </linearGradient>
          <linearGradient id={lensHighlightId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLORS.lensHighlight} />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
          </linearGradient>
          <filter
            id={lensWarpId}
            x={lensX - 12}
            y={lensY - 12}
            width={lensWidth + 24}
            height={lensHeight + 24}
            filterUnits="userSpaceOnUse"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012"
              numOctaves="1"
              seed="2"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="6"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <mask id={lensInsideId}>
            <rect x="0" y="0" width={width} height="100%" fill="black" />
            <rect
              x={lensX}
              y={lensY}
              width={lensWidth}
              height={lensHeight}
              rx={radius}
              ry={radius}
              fill="white"
            />
          </mask>
          <mask id={lensOutsideId}>
            <rect x="0" y="0" width={width} height="100%" fill="white" />
            <rect
              x={lensX}
              y={lensY}
              width={lensWidth}
              height={lensHeight}
              rx={radius}
              ry={radius}
              fill="black"
            />
          </mask>
          <g id={particleLayerId}>
            {particles.map(particle => (
              <ParticleElement key={particle.id} particle={particle} height={height} />
            ))}
          </g>
        </defs>
        <g mask={`url(#${lensOutsideId})`}>
          <use href={`#${particleLayerId}`} />
        </g>
        <g mask={`url(#${lensInsideId})`} filter={`url(#${lensWarpId})`}>
          <use href={`#${particleLayerId}`} />
        </g>
        <Lens fillId={lensFillId} highlightId={lensHighlightId} />
      </svg>
    </Box>
  )
}
