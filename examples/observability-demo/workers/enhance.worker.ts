/**
 * Enhance Worker - Singleton task example
 * Simulates ML-based image enhancement (GPU-bound, bottlenecked resource)
 */

import { expose } from 'comlink'
import {
  createTaskWorker,
  type StripTaskContext,
  type TaskContext,
} from '../../../core/task-worker'
import type { AnalysisResult } from './analyze.worker'

export interface EnhancedImage extends AnalysisResult {
  enhancementApplied: string[]
  qualityScore: number
  enhancementTime: number
}

function simulateWork(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const ENHANCEMENTS = [
  'noise reduction',
  'sharpening',
  'color correction',
  'contrast boost',
  'brightness adjustment',
]

const handlers = {
  async process(image: AnalysisResult, ctx: TaskContext): Promise<EnhancedImage> {
    // Simulate enhancement processing (200-600ms)
    const enhancementTime = 200 + Math.random() * 400
    await simulateWork(enhancementTime)
    ctx.throwIfAborted()

    // Simulate occasional errors (2% failure rate)
    if (Math.random() < 0.02) {
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
