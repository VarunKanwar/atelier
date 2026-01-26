import { useEffect, useRef, useState } from 'react'

export type Particle = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  inConduit: boolean
  claimed: boolean
  opacity: number
  phase: number
  wobbleRate: number
  wobbleAmp: number
}

// Dimensions
const WIDTH = 500
const HEIGHT = 180

// All positions as ratios of WIDTH/HEIGHT
const MARGIN_RATIO = 0.05
const Y_MARGIN = HEIGHT * MARGIN_RATIO
const CENTER_Y = HEIGHT / 2

// Zone X boundaries as ratios: []>=<[]
const ZONE_RATIOS = {
  freeEnd: 0.32,
  conduitStart: 0.4,
  conduitEnd: 0.6,
  arrivedStart: 0.68,
  fadeInEnd: 0.05,
  fadeOutStart: 0.94,
}

const ZONES = {
  freeStart: 0,
  freeEnd: WIDTH * ZONE_RATIOS.freeEnd,
  conduitStart: WIDTH * ZONE_RATIOS.conduitStart,
  conduitEnd: WIDTH * ZONE_RATIOS.conduitEnd,
  arrivedStart: WIDTH * ZONE_RATIOS.arrivedStart,
  arrivedEnd: WIDTH * 1.04,
  fadeInEnd: WIDTH * ZONE_RATIOS.fadeInEnd,
  fadeOutStart: WIDTH * ZONE_RATIOS.fadeOutStart,
}

// Funnel geometry as ratios of available height
const AVAILABLE_HEIGHT = HEIGHT - Y_MARGIN * 2
const FREE_ZONE_HALF_HEIGHT = AVAILABLE_HEIGHT / 2
const CONDUIT_HALF_HEIGHT_RATIO = 0.1
const CONDUIT_HALF_HEIGHT = HEIGHT * CONDUIT_HALF_HEIGHT_RATIO

// Capacity + tuning
const CONDUIT_CAPACITY = 10
const MAX_PARTICLES = 280
const INITIAL_PARTICLES = 180
const HOLD_ZONE_WIDTH = 90
const HOLD_ZONE_START = ZONES.freeEnd - HOLD_ZONE_WIDTH

// Timing
const TICK_MS = 30
const SPAWN_INTERVAL_MS = 45

// Motion
const DRIFT_FREE = 0
const DRIFT_CONDUIT = 1.5
const DRIFT_ARRIVED = 0.9
const FRICTION = 0.985
const CENTER_PULL = 0.02
const CENTER_PULL_MIN = 0.004
const WOBBLE_BASE = 0.6
const SPREAD_FORCE_EXIT = 0.004
const SPREAD_FORCE_ARRIVED = 0.0025
const VX_EASE = 0.07
const VY_EASE = 0.08
const WAIT_X_WOBBLE = 0.05

// Fade distances
const FADE_IN_DISTANCE = WIDTH * 0.05
const FADE_OUT_DISTANCE = WIDTH * 0.1

type FlowZone = 'free' | 'entry-funnel' | 'conduit' | 'exit-funnel' | 'arrived'

type YBounds = {
  minY: number
  maxY: number
  halfHeight: number
  zone: FlowZone
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function computeOpacity(x: number): number {
  if (x < ZONES.fadeInEnd) {
    return clamp(x / FADE_IN_DISTANCE, 0, 1)
  }
  if (x > ZONES.fadeOutStart) {
    return clamp(1 - (x - ZONES.fadeOutStart) / FADE_OUT_DISTANCE, 0, 1)
  }
  return 1
}

function getYBounds(x: number): YBounds {
  const fullMin = Y_MARGIN
  const fullMax = HEIGHT - Y_MARGIN
  const conduitMin = CENTER_Y - CONDUIT_HALF_HEIGHT
  const conduitMax = CENTER_Y + CONDUIT_HALF_HEIGHT

  if (x <= ZONES.freeEnd) {
    return { minY: fullMin, maxY: fullMax, halfHeight: FREE_ZONE_HALF_HEIGHT, zone: 'free' }
  }

  if (x <= ZONES.conduitStart) {
    const t = (x - ZONES.freeEnd) / (ZONES.conduitStart - ZONES.freeEnd)
    const halfHeight = FREE_ZONE_HALF_HEIGHT + (CONDUIT_HALF_HEIGHT - FREE_ZONE_HALF_HEIGHT) * t
    return { minY: CENTER_Y - halfHeight, maxY: CENTER_Y + halfHeight, halfHeight, zone: 'entry-funnel' }
  }

  if (x <= ZONES.conduitEnd) {
    return { minY: conduitMin, maxY: conduitMax, halfHeight: CONDUIT_HALF_HEIGHT, zone: 'conduit' }
  }

  if (x <= ZONES.arrivedStart) {
    const t = (x - ZONES.conduitEnd) / (ZONES.arrivedStart - ZONES.conduitEnd)
    const halfHeight = CONDUIT_HALF_HEIGHT + (FREE_ZONE_HALF_HEIGHT - CONDUIT_HALF_HEIGHT) * t
    return { minY: CENTER_Y - halfHeight, maxY: CENTER_Y + halfHeight, halfHeight, zone: 'exit-funnel' }
  }

  return { minY: fullMin, maxY: fullMax, halfHeight: FREE_ZONE_HALF_HEIGHT, zone: 'arrived' }
}

function createParticle(x?: number, y?: number): Particle {
  return {
    id: crypto.randomUUID(),
    x: x ?? randomInRange(6, 18),
    y: y ?? randomInRange(Y_MARGIN + 8, HEIGHT - Y_MARGIN - 8),
    vx: randomInRange(0.2, 0.7),
    vy: randomInRange(-0.2, 0.2),
    inConduit: false,
    claimed: false,
    opacity: x !== undefined ? 1 : 0,
    phase: Math.random() * Math.PI * 2,
    wobbleRate: randomInRange(0.4, 0.9),
    wobbleAmp: randomInRange(0.25, 0.6),
  }
}

function createInitialParticles(): Particle[] {
  const particles: Particle[] = []
  for (let i = 0; i < INITIAL_PARTICLES; i++) {
    const x = randomInRange(8, Math.max(12, ZONES.freeEnd - 8))
    const bounds = getYBounds(x)
    const y = randomInRange(bounds.minY + 4, bounds.maxY - 4)
    particles.push(createParticle(x, y))
  }
  return particles
}

export const PARTICLE_FLOW_DIMENSIONS = { width: WIDTH, height: HEIGHT }
export const PARTICLE_FLOW_ZONES = ZONES

export function useParticleFlow() {
  const [particles, setParticles] = useState<Particle[]>(createInitialParticles)
  const lastSpawnTime = useRef(0)
  const isVisibleRef = useRef(true)
  const reduceMotionRef = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleVisibility = () => {
      isVisibleRef.current = !document.hidden
    }
    handleVisibility()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => {
      reduceMotionRef.current = mediaQuery.matches
    }
    handleChange()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isVisibleRef.current || reduceMotionRef.current) return
      const now = Date.now()
      const time = now / 1000

      setParticles(prevParticles => {
        let updated = prevParticles.map(p => ({ ...p }))

        // Release conduit slots once particles exit, and keep inConduit aligned to position.
        updated.forEach(p => {
          if (p.claimed && p.x > ZONES.conduitEnd) {
            p.claimed = false
            p.inConduit = false
            return
          }
          p.inConduit = p.claimed && p.x >= ZONES.conduitStart && p.x <= ZONES.conduitEnd
        })

        let conduitCount = updated.filter(p => p.claimed).length
        let slotsOpen = Math.max(0, CONDUIT_CAPACITY - conduitCount)

        if (slotsOpen > 0) {
          const selectionPool = updated
            .filter(p => !p.claimed && p.x >= HOLD_ZONE_START && p.x <= ZONES.conduitStart + 6)
            .sort((a, b) => b.x - a.x)
            .slice(0, slotsOpen)
          for (const particle of selectionPool) {
            particle.claimed = true
            conduitCount += 1
            slotsOpen -= 1
            if (slotsOpen <= 0) break
          }
        }

        // Spawn new particles at left edge
        if (now - lastSpawnTime.current > SPAWN_INTERVAL_MS && updated.length < MAX_PARTICLES) {
          updated.push(createParticle())
          lastSpawnTime.current = now
        }

        updated = updated.map(p => {
          const next = { ...p }
          const bounds = getYBounds(next.x)
          const { zone } = bounds
          const narrowness = 1 - bounds.halfHeight / FREE_ZONE_HALF_HEIGHT

          const isSelected = next.claimed && !next.inConduit
          let targetVx = DRIFT_FREE
          if (next.inConduit || next.claimed) {
            targetVx = DRIFT_CONDUIT
          } else if (next.x >= ZONES.conduitEnd) {
            targetVx = DRIFT_ARRIVED
          }


          let wobbleAmp = next.wobbleAmp
          if (zone === 'exit-funnel') wobbleAmp *= 1.4
          if (zone === 'arrived') wobbleAmp *= 1.6
          const wobble = Math.sin(time * next.wobbleRate + next.phase) * wobbleAmp
          const centerPullScale = !next.claimed && next.x >= HOLD_ZONE_START ? 0.65 : 1
          const baseCenterPull = zone === 'free' ? 0 : CENTER_PULL_MIN + narrowness * CENTER_PULL
          const centerPull = baseCenterPull * centerPullScale
          const spreadScale = (next.y - CENTER_Y) / Math.max(1, FREE_ZONE_HALF_HEIGHT)
          const spreadForce =
            zone === 'exit-funnel' ? SPREAD_FORCE_EXIT : zone === 'arrived' ? SPREAD_FORCE_ARRIVED : 0
          const targetVy =
            (CENTER_Y - next.y) * centerPull +
            wobble * (1 - narrowness) * WOBBLE_BASE +
            spreadScale * spreadForce

          if (!next.claimed && next.x < ZONES.conduitEnd) {
            const xWobble = Math.sin(time * 0.35 + next.phase * 1.7) * WAIT_X_WOBBLE
            next.vx += xWobble
          }

          next.vx += (targetVx - next.vx) * VX_EASE
          next.vy += (targetVy - next.vy) * VY_EASE

          next.vx *= FRICTION
          next.vy *= FRICTION

          next.x += next.vx
          next.y += next.vy

          if (!next.claimed && next.x >= ZONES.conduitStart && next.x < ZONES.conduitEnd) {
            next.x = ZONES.conduitStart - 0.5
            next.vx = 0
          }

          const nextBounds = getYBounds(next.x)
          next.y = clamp(next.y, nextBounds.minY + 1, nextBounds.maxY - 1)


          if (next.x < 3) {
            next.x = 3
            next.vx = Math.abs(next.vx) * 0.3
          }

          next.opacity = computeOpacity(next.x)
          return next
        })

        updated = updated.filter(p => p.x < ZONES.arrivedEnd)
        return updated
      })
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [])

  return particles
}
