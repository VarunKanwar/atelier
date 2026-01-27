import { useEffect, useRef, useState } from 'react'

export type Particle = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  claimed: boolean
  opacity: number
  phase: number
  wobbleRate: number
  wobbleAmp: number
  exitBias: number
}

// Dimensions (SVG viewBox units)
const WIDTH = 500 // x-axis units
const HEIGHT = 180 // y-axis units

// Layout ratios (unitless)
const MARGIN_RATIO = 0.05 // fraction of HEIGHT used as top/bottom margin
const Y_MARGIN = HEIGHT * MARGIN_RATIO // units
const CENTER_Y = HEIGHT / 2 // units

// Zone X boundaries as ratios: []>=<[] (unitless fractions of WIDTH)
const ZONE_RATIOS = {
  freeEnd: 0.45, // end of free zone
  conduitStart: 0.5, // funnel end / conduit start
  conduitEnd: 0.6, // conduit end / exit funnel start
  arrivedStart: 0.68, // exit funnel end / arrived start
  fadeInEnd: 0.05, // opacity reaches 1
  fadeOutStart: 0.94, // opacity begins fading
}

// Zone boundaries (units)
const ZONES = {
  freeEnd: WIDTH * ZONE_RATIOS.freeEnd, // units
  conduitStart: WIDTH * ZONE_RATIOS.conduitStart, // units
  conduitEnd: WIDTH * ZONE_RATIOS.conduitEnd, // units
  arrivedStart: WIDTH * ZONE_RATIOS.arrivedStart, // units
  arrivedEnd: WIDTH * 1.04, // units; spawn can exit slightly off-screen
  fadeInEnd: WIDTH * ZONE_RATIOS.fadeInEnd, // units
  fadeOutStart: WIDTH * ZONE_RATIOS.fadeOutStart, // units
}

// Funnel geometry (units unless noted)
const AVAILABLE_HEIGHT = HEIGHT - Y_MARGIN * 2 // units
const FREE_ZONE_HALF_HEIGHT = AVAILABLE_HEIGHT / 2 // units
const CONDUIT_HALF_HEIGHT_RATIO = 0.1 // unitless fraction of HEIGHT
const CONDUIT_HALF_HEIGHT = HEIGHT * CONDUIT_HALF_HEIGHT_RATIO // units

// Capacity + tuning (counts and units)
const CONDUIT_CAPACITY = 15 // particles; max simultaneous claimed slots
const MAX_PARTICLES = 280 // particles; global cap
const INITIAL_PARTICLES = 180 // particles; initial seeding
const HOLD_ZONE_WIDTH = 90 // units; region left of funnel used for selection
const HOLD_ZONE_START = ZONES.freeEnd - HOLD_ZONE_WIDTH // units

// Timing (milliseconds)
const TICK_MS = 30 // ms; simulation step interval
const SPAWN_INTERVAL_MS = 45 // ms; new particle cadence

// Motion (units per tick unless noted)
const DRIFT_FREE = 0.25 // units/tick; x drift in free zone
const DRIFT_CONDUIT = 1.5 // units/tick; x drift for claimed particles
const DRIFT_ARRIVED = 0.9 // units/tick; x drift after conduit
const FRICTION = 0.985 // unitless; velocity multiplier per tick
const CENTER_PULL = 0.02 // 1/tick; centering strength at narrowest
const CENTER_PULL_MIN = 0.004 // 1/tick; baseline centering
const WOBBLE_BASE = 0.6 // units/tick; amplitude scale for y wobble
const EXIT_PULL = 0.025 // 1/tick; steer toward exit bias in funnel
const ARRIVED_PULL = 0.012 // 1/tick; steer toward exit bias in arrived zone
const VX_EASE = 0.07 // 1/tick; x velocity easing factor
const VY_EASE = 0.08 // 1/tick; y velocity easing factor
const VELOCITY_JITTER = 0.02 // units/tick; random per-tick jitter magnitude

// Fade distances (units)
const FADE_IN_DISTANCE = WIDTH * 0.1 // units; fade-in span
const FADE_OUT_DISTANCE = WIDTH * 0.1 // units; fade-out span

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
    vx: randomInRange(-0.2, 0.2),
    vy: randomInRange(-0.2, 0.2),
    claimed: false,
    opacity: x !== undefined ? 1 : 0,
    phase: Math.random() * Math.PI * 2,
    wobbleRate: randomInRange(0.4, 0.9),
    wobbleAmp: randomInRange(0.25, 0.6),
    exitBias: 0,
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
export const PARTICLE_FLOW_GEOMETRY = {
  centerY: CENTER_Y,
  conduitHalfHeight: CONDUIT_HALF_HEIGHT,
  yMargin: Y_MARGIN,
}

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

        // Release conduit slots once particles exit.
        updated.forEach(p => {
          if (p.claimed && p.x > ZONES.conduitEnd) {
            p.claimed = false
            p.exitBias = randomInRange(-1, 1)
          }
        })

        const claimedCount = updated.filter(p => p.claimed).length
        let slotsOpen = Math.max(0, CONDUIT_CAPACITY - claimedCount)

        if (slotsOpen > 0) {
          const selectionPool = updated
            .filter(p => !p.claimed && p.x >= ZONES.freeEnd && p.x < ZONES.conduitStart)
            .sort((a, b) => b.x - a.x)
            .slice(0, slotsOpen)
          for (const particle of selectionPool) {
            particle.claimed = true
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

          let targetVx = DRIFT_FREE
          if (next.claimed) {
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
          const shouldSpread = !next.claimed && next.x >= ZONES.conduitEnd
          const exitTargetY = CENTER_Y + next.exitBias * FREE_ZONE_HALF_HEIGHT
          const exitPull = zone === 'exit-funnel' ? EXIT_PULL : zone === 'arrived' ? ARRIVED_PULL : 0
          const targetVy =
            (CENTER_Y - next.y) * centerPull +
            wobble * (1 - narrowness) * WOBBLE_BASE +
            (shouldSpread ? (exitTargetY - next.y) * exitPull : 0)

          next.vx += (targetVx - next.vx) * VX_EASE
          next.vy += (targetVy - next.vy) * VY_EASE
          const jitterX = (Math.random() - 0.5) * VELOCITY_JITTER
          const jitterY = (Math.random() - 0.5) * VELOCITY_JITTER
          next.vx += jitterX
          next.vy += jitterY

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
