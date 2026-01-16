import { parallelLimit, type TaskRuntime } from '../../../src'
import type { Task } from '../../../src/define-task'
import type { TaskConfig, TaskDispatchOptions } from '../../../src/types'

import type { AnalyzeAPI } from '../workers/analyze.worker'
import type { EnhanceAPI } from '../workers/enhance.worker'
import type { ImageData, ResizeAPI } from '../workers/resize.worker'

export type PipelineTasks = {
  resize: Task<ResizeAPI>
  analyze: Task<AnalyzeAPI>
  enhance: Task<EnhanceAPI>
}

export type PipelineStage = 'resize' | 'analyze' | 'enhance'

export type PipelineTaskOverrides = {
  resize?: Partial<TaskConfig>
  analyze?: Partial<TaskConfig>
  enhance?: Partial<TaskConfig>
}

export type PipelineResult =
  | { status: 'fulfilled'; item: ImageData; value: Awaited<ReturnType<EnhanceAPI['process']>> }
  | { status: 'rejected'; item: ImageData; error: unknown }

export const generateImages = (count: number): ImageData[] => {
  return Array.from({ length: count }, (_, i) => ({
    name: `image-${String(i + 1).padStart(3, '0')}.jpg`,
    width: 1920 + Math.floor(Math.random() * 1080),
    height: 1080 + Math.floor(Math.random() * 920),
    size: 1_000_000 + Math.floor(Math.random() * 5_000_000),
  }))
}

const defaultTaskConfig = {
  resize: {
    type: 'parallel',
    worker: () =>
      new Worker(new URL('../workers/resize.worker.ts', import.meta.url), { type: 'module' }),
    poolSize: 4,
    init: 'lazy',
    taskName: 'resize',
    taskId: 'resize',
  } satisfies TaskConfig,
  analyze: {
    type: 'singleton',
    worker: () =>
      new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), { type: 'module' }),
    init: 'eager',
    taskName: 'analyze',
    taskId: 'analyze',
  } satisfies TaskConfig,
  enhance: {
    type: 'singleton',
    worker: () =>
      new Worker(new URL('../workers/enhance.worker.ts', import.meta.url), { type: 'module' }),
    init: 'lazy',
    taskName: 'enhance',
    taskId: 'enhance',
    idleTimeoutMs: 10 * 1000,
  } satisfies TaskConfig,
}

export const createImagePipelineTasks = (
  runtime: TaskRuntime,
  overrides: PipelineTaskOverrides = {}
): PipelineTasks => {
  const resize = runtime.defineTask<ResizeAPI>({
    ...defaultTaskConfig.resize,
    ...overrides.resize,
  })
  const analyze = runtime.defineTask<AnalyzeAPI>({
    ...defaultTaskConfig.analyze,
    ...overrides.analyze,
  })
  const enhance = runtime.defineTask<EnhanceAPI>({
    ...defaultTaskConfig.enhance,
    ...overrides.enhance,
  })

  return { resize, analyze, enhance }
}

export const disposeImagePipelineTasks = (tasks: PipelineTasks | null) => {
  if (!tasks) return
  tasks.resize.dispose()
  tasks.analyze.dispose()
  tasks.enhance.dispose()
}

export async function* runImagePipeline(options: {
  tasks: PipelineTasks
  images: ImageData[]
  concurrencyLimit: number
  dispatchOptions?: TaskDispatchOptions
  beforeStage?: (stage: PipelineStage, payload: unknown) => void | Promise<void>
}): AsyncGenerator<PipelineResult> {
  const { tasks, images, concurrencyLimit, dispatchOptions, beforeStage } = options
  const resizeTask = dispatchOptions ? tasks.resize.with(dispatchOptions) : tasks.resize
  const analyzeTask = dispatchOptions ? tasks.analyze.with(dispatchOptions) : tasks.analyze
  const enhanceTask = dispatchOptions ? tasks.enhance.with(dispatchOptions) : tasks.enhance

  const processImage = async (image: ImageData) => {
    if (beforeStage) {
      await beforeStage('resize', image)
    }
    const resized = await resizeTask.process(image)
    if (beforeStage) {
      await beforeStage('analyze', resized)
    }
    const analyzed = await analyzeTask.process(resized)
    if (beforeStage) {
      await beforeStage('enhance', analyzed)
    }
    return enhanceTask.process(analyzed)
  }

  for await (const result of parallelLimit(images, concurrencyLimit, processImage, {
    returnSettled: true,
  })) {
    if (result.status === 'fulfilled') {
      yield { status: 'fulfilled', item: result.item, value: result.value }
    } else {
      yield { status: 'rejected', item: result.item, error: result.error }
    }
  }
}
