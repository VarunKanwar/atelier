/**
 * Resize Worker - Parallel task example
 * Simulates image resizing (CPU-bound, parallelizable)
 */

import { expose } from 'comlink'
import {
  createTaskWorker,
  type StripTaskContext,
  type TaskContext,
} from '../../../core/task-worker'

export interface ImageData {
  name: string
  width: number
  height: number
  size: number
}

export interface ResizedImage extends ImageData {
  resizedWidth: number
  resizedHeight: number
  processingTime: number
}

// Simulate variable processing time
function simulateWork(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const handlers = {
  async process(image: ImageData, ctx: TaskContext): Promise<ResizedImage> {
    // Simulate variable resize time (100-500ms)
    const processingTime = 100 + Math.random() * 400
    await simulateWork(processingTime)
    ctx.throwIfAborted()

    // Simulate occasional errors (5% failure rate)
    if (Math.random() < 0.05) {
      throw new Error(`Failed to resize ${image.name}: Corrupted image data`)
    }

    // Calculate new dimensions (resize to max 800px)
    const maxDimension = 800
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const resizedWidth = Math.floor(image.width * scale)
    const resizedHeight = Math.floor(image.height * scale)

    return {
      ...image,
      resizedWidth,
      resizedHeight,
      processingTime: Math.floor(processingTime),
    }
  },
}

export type ResizeAPI = StripTaskContext<typeof handlers>

expose(createTaskWorker(handlers))
