/**
 * Enhance Worker - Singleton task example
 * Simulates ML-based image enhancement (GPU-bound, bottlenecked resource)
 */

import { expose } from 'comlink'
import { createTaskWorker, type StripTaskContext, type TaskContext } from '../../../src/task-worker'
import type { AnalysisResult } from './analyze.worker'

export interface EnhancedImage extends AnalysisResult {
  enhancementApplied: string[]
  qualityScore: number
  enhancementTime: number
}

function simulateWork(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let errorRate = 0
let crashNext = false

const clampRate = (value: number) => Math.min(1, Math.max(0, value))

const injectCrashIfNeeded = async () => {
  if (!crashNext) return
  crashNext = false
  setTimeout(() => {
    throw new Error('Injected worker crash')
  }, 0)
  await new Promise(() => {})
}

const ENHANCEMENTS = [
  'noise reduction',
  'sharpening',
  'color correction',
  'contrast boost',
  'brightness adjustment',
]

const handlers = {
  setErrorRate(rate: number) {
    errorRate = clampRate(rate)
  },
  crashNext() {
    crashNext = true
  },
  async process(image: AnalysisResult, ctx: TaskContext): Promise<EnhancedImage> {
    // Simulate enhancement processing (200-600ms)
    const enhancementTime = 200 + Math.random() * 400
    await simulateWork(enhancementTime)
    await injectCrashIfNeeded()
    ctx.throwIfAborted()

    // Simulate optional errors when configured.
    if (errorRate > 0 && Math.random() < errorRate) {
      throw new Error(`Enhancement failed for ${image.name}: Invalid input format`)
    }

    // Apply random enhancements
    const numEnhancements = 2 + Math.floor(Math.random() * 3)
    const enhancementApplied = Array.from(
      { length: numEnhancements },
      () => ENHANCEMENTS[Math.floor(Math.random() * ENHANCEMENTS.length)]
    )

    const qualityScore = 0.8 + Math.random() * 0.15

    return {
      ...image,
      enhancementApplied,
      qualityScore,
      enhancementTime: Math.floor(enhancementTime),
    }
  },
}

export type EnhanceAPI = StripTaskContext<typeof handlers>

expose(createTaskWorker(handlers))
