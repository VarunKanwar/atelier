/**
 * Analyze Worker - Singleton task example
 * Simulates ML model analysis (GPU-bound, bottlenecked resource)
 */

import { createTaskWorker, type StripTaskContext, type TaskContext } from '@varunkanwar/atelier'
import { expose } from 'comlink'
import type { ResizedImage } from './resize.worker'

export interface AnalysisResult extends ResizedImage {
  objects: string[]
  confidence: number
  modelLoadTime?: number
  inferenceTime: number
}

// Simulate model loading delay
let modelLoaded = false
const MODEL_LOAD_TIME = 2000 // 2 seconds to "load model"

async function ensureModelLoaded(): Promise<number> {
  if (modelLoaded) return 0

  console.log('[Analyze Worker] Loading ML model...')
  await new Promise(resolve => setTimeout(resolve, MODEL_LOAD_TIME))
  modelLoaded = true
  console.log('[Analyze Worker] Model loaded!')
  return MODEL_LOAD_TIME
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

// Simulated object detection labels
const OBJECTS = [
  'person',
  'car',
  'tree',
  'building',
  'dog',
  'cat',
  'bicycle',
  'flower',
  'sign',
  'sky',
]

const handlers = {
  setErrorRate(rate: number) {
    errorRate = clampRate(rate)
  },
  crashNext() {
    crashNext = true
  },
  async process(image: ResizedImage, ctx: TaskContext): Promise<AnalysisResult> {
    // Ensure model is loaded (lazy loading simulation)
    const modelLoadTime = await ensureModelLoaded()

    // Simulate ML inference (300-800ms per image)
    const inferenceTime = 300 + Math.random() * 500
    await simulateWork(inferenceTime)
    await injectCrashIfNeeded()
    ctx.throwIfAborted()

    // Simulate optional errors when configured.
    if (errorRate > 0 && Math.random() < errorRate) {
      throw new Error(`Analysis failed for ${image.name}: Out of memory`)
    }

    // Generate random objects detected
    const numObjects = 1 + Math.floor(Math.random() * 4)
    const objects = Array.from(
      { length: numObjects },
      () => OBJECTS[Math.floor(Math.random() * OBJECTS.length)]
    )

    const confidence = 0.7 + Math.random() * 0.25

    const result: AnalysisResult = {
      ...image,
      objects,
      confidence,
      inferenceTime: Math.floor(inferenceTime),
    }

    if (modelLoadTime > 0) {
      result.modelLoadTime = modelLoadTime
    }

    return result
  },
}

export type AnalyzeAPI = StripTaskContext<typeof handlers>

expose(createTaskWorker(handlers))
