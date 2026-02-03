import { useEffect, useRef, useState } from 'react'

type TimelineOptions = {
  durationMs?: number
  stepMs?: number
}

const DEFAULT_DURATION_MS = 9000
const DEFAULT_STEP_MS = 80

export function useObservabilityTimeline(options: TimelineOptions = {}) {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS
  const stepMs = options.stepMs ?? DEFAULT_STEP_MS
  const [progress, setProgress] = useState(1)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPausedRef = useRef(false)
  const startRef = useRef(Date.now())
  const tickRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches)
    handleChange()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    if (prefersReducedMotion) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      setProgress(1)
      return
    }

    let active = true
    const tick = () => {
      if (!active || isPausedRef.current) return
      const now = Date.now()
      const elapsed = (now - startRef.current) % durationMs
      setProgress(elapsed / durationMs)
      timeoutRef.current = setTimeout(tick, stepMs)
    }
    tickRef.current = tick

    startRef.current = Date.now()
    tick()

    return () => {
      active = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [durationMs, prefersReducedMotion, stepMs])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleVisibility = () => {
      if (document.hidden) {
        isPausedRef.current = true
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        return
      }
      isPausedRef.current = false
      startRef.current = Date.now()
      tickRef.current()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  return { progress, prefersReducedMotion }
}
