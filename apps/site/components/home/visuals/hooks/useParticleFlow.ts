import { useEffect, useRef, useState } from 'react'

export type Particle = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  inConduit: boolean
  opacity: number
}

// Dimensions
const WIDTH = 500
const HEIGHT = 200

// All positions as ratios of WIDTH/HEIGHT
const MARGIN_RATIO = 0.04 // 4% margin top/bottom
const Y_MARGIN = HEIGHT * MARGIN_RATIO
const CENTER_Y = HEIGHT / 2

// Zone X boundaries as ratios: []>=<[]
const ZONE_RATIOS = {
  freeEnd: 0.32, // Free zone ends at 32% - wider mouth
  conduitStart: 0.4, // Entry funnel ends, conduit starts at 40% - shorter funnel
  conduitEnd: 0.6, // Conduit ends at 60%
  arrivedStart: 0.68, // Exit funnel ends at 68% - shorter funnel, wider mouth
  fadeInEnd: 0.05, // Fade in complete by 5%
  fadeOutStart: 0.94, // Start fading out at 94%
}

const ZONES = {
  freeStart: 0,
  freeEnd: WIDTH * ZONE_RATIOS.freeEnd,
  conduitStart: WIDTH * ZONE_RATIOS.conduitStart,
  conduitEnd: WIDTH * ZONE_RATIOS.conduitEnd,
  arrivedStart: WIDTH * ZONE_RATIOS.arrivedStart,
  arrivedEnd: WIDTH * 1.04, // Slightly past edge for exit
  fadeInEnd: WIDTH * ZONE_RATIOS.fadeInEnd,
  fadeOutStart: WIDTH * ZONE_RATIOS.fadeOutStart,
}

// Funnel geometry as ratios of available height
const AVAILABLE_HEIGHT = HEIGHT - Y_MARGIN * 2
const FREE_ZONE_HALF_HEIGHT = AVAILABLE_HEIGHT / 2
const CONDUIT_HALF_HEIGHT_RATIO = 0.1 // Conduit is 20% of total height
const CONDUIT_HALF_HEIGHT = HEIGHT * CONDUIT_HALF_HEIGHT_RATIO

// Capacity
const CONDUIT_CAPACITY = 12
const MAX_PARTICLES = 200

// Timing
const TICK_MS = 20
const SPAWN_INTERVAL_MS = 70

// Physics
const BASE_SPEED = 0.8
const FRICTION = 0.997
const BOUNCE_DAMPING = 0.5 // Much more energy loss on bounce
const DRIFT_FORCE = 0.008 // Gentle constant pull toward/away from conduit
const CONDUIT_CENTERING = 0.012
const SPREAD_STRENGTH = 0.015 // For exit funnel spreading
// Speed limits - particles slow down as they approach conduit
const SPEED_FAR = 1.2 // Max speed far from conduit
const SPEED_NEAR = 0.25 // Max speed near conduit entrance

// Fade distances as ratios
const FADE_IN_DISTANCE = WIDTH * 0.05
const FADE_OUT_DISTANCE = WIDTH * 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomVelocity(speed: number): { vx: number; vy: number } {
  const angle = Math.random() * Math.PI * 2
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  }
}

// Get Y bounds at any X position based on the []>=<[] shape
function getYBounds(x: number): {
  minY: number
  maxY: number
  zone: 'free' | 'entry-funnel' | 'conduit' | 'exit-funnel' | 'arrived'
} {
  const fullMin = Y_MARGIN
  const fullMax = HEIGHT - Y_MARGIN
  const conduitMin = CENTER_Y - CONDUIT_HALF_HEIGHT
  const conduitMax = CENTER_Y + CONDUIT_HALF_HEIGHT

  // Free zone - full height
  if (x <= ZONES.freeEnd) {
    return { minY: fullMin, maxY: fullMax, zone: 'free' }
  }

  // Entry funnel ">" - narrows linearly
  if (x <= ZONES.conduitStart) {
    const t = (x - ZONES.freeEnd) / (ZONES.conduitStart - ZONES.freeEnd)
    const halfHeight = FREE_ZONE_HALF_HEIGHT + (CONDUIT_HALF_HEIGHT - FREE_ZONE_HALF_HEIGHT) * t
    return {
      minY: CENTER_Y - halfHeight,
      maxY: CENTER_Y + halfHeight,
      zone: 'entry-funnel',
    }
  }

  // Conduit "=" - narrow passage
  if (x <= ZONES.conduitEnd) {
    return { minY: conduitMin, maxY: conduitMax, zone: 'conduit' }
  }

  // Exit funnel "<" - expands linearly
  if (x <= ZONES.arrivedStart) {
    const t = (x - ZONES.conduitEnd) / (ZONES.arrivedStart - ZONES.conduitEnd)
    const halfHeight = CONDUIT_HALF_HEIGHT + (FREE_ZONE_HALF_HEIGHT - CONDUIT_HALF_HEIGHT) * t
    return {
      minY: CENTER_Y - halfHeight,
      maxY: CENTER_Y + halfHeight,
      zone: 'exit-funnel',
    }
  }

  // Arrived zone - full height
  return { minY: fullMin, maxY: fullMax, zone: 'arrived' }
}

// Calculate the normal vector for funnel walls (for bouncing)
function getFunnelNormal(_x: number, y: number, zone: string): { nx: number; ny: number } | null {
  if (zone === 'entry-funnel') {
    // ">" shape - walls angle inward
    if (y < CENTER_Y) {
      // Top wall: normal points down-left
      return { nx: -0.7, ny: 0.7 }
    } else {
      // Bottom wall: normal points up-left
      return { nx: -0.7, ny: -0.7 }
    }
  }
  if (zone === 'exit-funnel') {
    // "<" shape - walls angle outward
    if (y < CENTER_Y) {
      // Top wall: normal points down-right
      return { nx: 0.7, ny: 0.7 }
    } else {
      // Bottom wall: normal points up-right
      return { nx: 0.7, ny: -0.7 }
    }
  }
  return null
}

function reflectVelocity(
  vx: number,
  vy: number,
  nx: number,
  ny: number,
  damping: number
): { vx: number; vy: number } {
  // v' = v - 2(v·n)n
  const dot = vx * nx + vy * ny
  return {
    vx: (vx - 2 * dot * nx) * damping,
    vy: (vy - 2 * dot * ny) * damping,
  }
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

function createParticle(x?: number, y?: number, vx?: number, vy?: number): Particle {
  const pos = {
    x: x ?? randomInRange(5, 15),
    y: y ?? randomInRange(Y_MARGIN + 15, HEIGHT - Y_MARGIN - 15),
  }
  const vel =
    vx !== undefined && vy !== undefined
      ? { vx, vy }
      : randomVelocity(BASE_SPEED * (0.5 + Math.random() * 0.5))

  return {
    id: crypto.randomUUID(),
    ...pos,
    ...vel,
    inConduit: false,
    opacity: x !== undefined ? 1 : 0,
  }
}

function createInitialParticles(): Particle[] {
  const particles: Particle[] = []

  // Dense cloud in free zone
  for (let i = 0; i < 80; i++) {
    const x = randomInRange(10, ZONES.freeEnd - 10)
    const y = randomInRange(Y_MARGIN + 10, HEIGHT - Y_MARGIN - 10)
    const vel = randomVelocity(BASE_SPEED * (0.4 + Math.random() * 0.6))
    particles.push(createParticle(x, y, vel.vx, vel.vy))
  }

  // Some in entry funnel
  for (let i = 0; i < 10; i++) {
    const x = randomInRange(ZONES.freeEnd + 10, ZONES.conduitStart - 10)
    const bounds = getYBounds(x)
    const y = randomInRange(bounds.minY + 5, bounds.maxY - 5)
    const vel = { vx: BASE_SPEED * 0.5, vy: (Math.random() - 0.5) * 0.3 }
    particles.push(createParticle(x, y, vel.vx, vel.vy))
  }

  // Some in conduit
  for (let i = 0; i < 8; i++) {
    const x = randomInRange(ZONES.conduitStart + 10, ZONES.conduitEnd - 10)
    const bounds = getYBounds(x)
    const y = randomInRange(bounds.minY + 3, bounds.maxY - 3)
    const p = createParticle(x, y, BASE_SPEED * 0.6, 0)
    p.inConduit = true
    particles.push(p)
  }

  // Some in exit funnel
  for (let i = 0; i < 6; i++) {
    const x = randomInRange(ZONES.conduitEnd + 10, ZONES.arrivedStart - 10)
    const bounds = getYBounds(x)
    const y = randomInRange(bounds.minY + 5, bounds.maxY - 5)
    const spreadDir = y < CENTER_Y ? -1 : 1
    const vel = { vx: BASE_SPEED * 0.6, vy: spreadDir * Math.random() * 0.5 }
    particles.push(createParticle(x, y, vel.vx, vel.vy))
  }

  // Some in arrived zone
  for (let i = 0; i < 10; i++) {
    const x = randomInRange(ZONES.arrivedStart + 10, ZONES.fadeOutStart - 20)
    const y = randomInRange(Y_MARGIN + 15, HEIGHT - Y_MARGIN - 15)
    const vel = randomVelocity(BASE_SPEED * 0.3)
    vel.vx = Math.abs(vel.vx) * 0.3 + 0.2
    particles.push(createParticle(x, y, vel.vx, vel.vy))
  }

  return particles
}

export const PARTICLE_FLOW_DIMENSIONS = { width: WIDTH, height: HEIGHT }
export const PARTICLE_FLOW_ZONES = ZONES

export function useParticleFlow() {
  const [particles, setParticles] = useState<Particle[]>(createInitialParticles)
  const lastSpawnTime = useRef(0)
  const isVisibleRef = useRef(true)

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
    const interval = setInterval(() => {
      if (!isVisibleRef.current) return
      const now = Date.now()

      setParticles(prevParticles => {
        let particles = [...prevParticles]
        let conduitCount = particles.filter(p => p.inConduit).length

        // Spawn new particles at left edge
        if (now - lastSpawnTime.current > SPAWN_INTERVAL_MS && particles.length < MAX_PARTICLES) {
          particles.push(createParticle())
          lastSpawnTime.current = now
        }

        particles = particles.map(p => {
          const updated = { ...p }
          const bounds = getYBounds(updated.x)
          const { zone } = bounds

          // === CONDUIT CLAIMING ===
          const inConduitZone = zone === 'conduit'
          if (!updated.inConduit && inConduitZone) {
            if (conduitCount < CONDUIT_CAPACITY) {
              updated.inConduit = true
              conduitCount++
            }
          }
          if (updated.inConduit && zone !== 'conduit') {
            updated.inConduit = false
          }

          // === PHYSICS ===
          let ax = 0
          let ay = 0
          let maxSpeed = SPEED_FAR

          // Symmetric drift + speed limit based on distance from conduit
          if (updated.x < ZONES.conduitStart) {
            // LEFT SIDE: Vacuum pulls toward conduit
            ax = DRIFT_FORCE
            // Speed limit inversely proportional to distance from conduit
            const distToConduit = ZONES.conduitStart - updated.x
            const maxDist = ZONES.conduitStart
            const t = distToConduit / maxDist // 1 at far left, 0 at conduit
            maxSpeed = SPEED_NEAR + (SPEED_FAR - SPEED_NEAR) * t
            // Slight pull toward center Y, increasing near conduit
            const dy = CENTER_Y - updated.y
            ay = dy * 0.003 * (1 - t)
          } else if (updated.x > ZONES.conduitEnd) {
            // RIGHT SIDE: Push away from conduit (symmetric)
            ax = DRIFT_FORCE
            // Speed limit inversely proportional to distance from conduit
            const distFromConduit = updated.x - ZONES.conduitEnd
            const maxDist = ZONES.arrivedEnd - ZONES.conduitEnd
            const t = distFromConduit / maxDist // 0 near conduit, 1 at far right
            maxSpeed = SPEED_NEAR + (SPEED_FAR - SPEED_NEAR) * t
          }

          // Zone-specific adjustments
          if (zone === 'free') {
            // Add small random perturbations
            ax += (Math.random() - 0.5) * 0.004
            ay += (Math.random() - 0.5) * 0.004
          } else if (zone === 'entry-funnel') {
            // Pull toward center Y in funnel
            const dy = CENTER_Y - updated.y
            ay += dy * 0.008
          } else if (zone === 'conduit') {
            if (updated.inConduit) {
              // In conduit: gentle centering, maintain moderate speed
              const dy = CENTER_Y - updated.y
              ay = dy * CONDUIT_CENTERING
              maxSpeed = SPEED_NEAR * 1.5 // Slightly faster in conduit
              if (updated.vx < SPEED_NEAR) {
                updated.vx = SPEED_NEAR
              }
            } else {
              // Not in conduit but in conduit zone - slow to a crawl
              maxSpeed = SPEED_NEAR * 0.5
              ax = -0.002 // Very gentle push back
            }
          } else if (zone === 'exit-funnel') {
            // Particles spread out as funnel expands
            const spreadDir = updated.y < CENTER_Y ? -1 : 1
            ay += spreadDir * SPREAD_STRENGTH
          } else if (zone === 'arrived') {
            // Small random perturbations like free zone
            ax += (Math.random() - 0.5) * 0.004
            ay += (Math.random() - 0.5) * 0.004
          }

          // Apply acceleration
          updated.vx += ax
          updated.vy += ay

          // Apply friction
          updated.vx *= FRICTION
          updated.vy *= FRICTION

          // Cap speed based on distance from conduit (creates natural compression)
          const speed = Math.sqrt(updated.vx * updated.vx + updated.vy * updated.vy)
          if (speed > maxSpeed) {
            const scale = maxSpeed / speed
            updated.vx *= scale
            updated.vy *= scale
          }

          // Update position
          updated.x += updated.vx
          updated.y += updated.vy

          // === BOUNDARY COLLISIONS ===
          const newBounds = getYBounds(updated.x)

          // Funnel wall collisions (diagonal bouncing)
          if (
            (newBounds.zone === 'entry-funnel' || newBounds.zone === 'exit-funnel') &&
            (updated.y < newBounds.minY || updated.y > newBounds.maxY)
          ) {
            const normal = getFunnelNormal(updated.x, updated.y, newBounds.zone)
            if (normal) {
              const reflected = reflectVelocity(
                updated.vx,
                updated.vy,
                normal.nx,
                normal.ny,
                BOUNCE_DAMPING
              )
              updated.vx = reflected.vx
              updated.vy = reflected.vy
            }
            // Clamp position inside bounds
            updated.y = clamp(updated.y, newBounds.minY + 1, newBounds.maxY - 1)
          }

          // Conduit walls (horizontal bounce)
          if (newBounds.zone === 'conduit') {
            if (updated.y < newBounds.minY) {
              updated.y = newBounds.minY
              updated.vy = Math.abs(updated.vy) * BOUNCE_DAMPING
            } else if (updated.y > newBounds.maxY) {
              updated.y = newBounds.maxY
              updated.vy = -Math.abs(updated.vy) * BOUNCE_DAMPING
            }
          }

          // Top/bottom walls (free and arrived zones)
          if (newBounds.zone === 'free' || newBounds.zone === 'arrived') {
            if (updated.y < newBounds.minY) {
              updated.y = newBounds.minY
              updated.vy = Math.abs(updated.vy) * BOUNCE_DAMPING
            } else if (updated.y > newBounds.maxY) {
              updated.y = newBounds.maxY
              updated.vy = -Math.abs(updated.vy) * BOUNCE_DAMPING
            }
          }

          // Left wall
          if (updated.x < 3) {
            updated.x = 3
            updated.vx = Math.abs(updated.vx) * BOUNCE_DAMPING
          }

          // Right boundary of free zone - soft boundary that guides toward funnel
          if (zone === 'free' && updated.x > ZONES.freeEnd - 5) {
            // Check if particle would enter funnel bounds
            const funnelBounds = getYBounds(ZONES.freeEnd + 1)
            if (updated.y < funnelBounds.minY || updated.y > funnelBounds.maxY) {
              // Bounce back - not aligned with funnel entrance
              updated.x = ZONES.freeEnd - 5
              updated.vx = -Math.abs(updated.vx) * BOUNCE_DAMPING * 0.5
            }
          }

          // Update opacity
          updated.opacity = computeOpacity(updated.x)

          return updated
        })

        // Remove exited particles
        particles = particles.filter(p => p.x < ZONES.arrivedEnd)

        return particles
      })
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [])

  return particles
}
