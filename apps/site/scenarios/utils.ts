export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  return (error as { name?: string }).name === 'AbortError'
}

export const clampNumber = (value: number, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}
