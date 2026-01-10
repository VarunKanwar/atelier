import { type AbortTaskController, createAbortTaskController } from './abort-task-controller'
import { createDefineTask, type Task } from './define-task'
import type { InitMode, TaskConfig, TaskExecutor, TaskType, WorkerState } from './types'

export type RuntimeTaskSnapshot = WorkerState & {
  taskId: string
  taskName?: string
  init: InitMode
}

export type RuntimeSnapshot = {
  tasks: RuntimeTaskSnapshot[]
}

export type RuntimeSnapshotSubscriptionOptions = {
  intervalMs?: number
  emitImmediately?: boolean
  onlyOnChange?: boolean
}

export type TaskRuntime = {
  // biome-ignore lint/suspicious/noExplicitAny: Generic default allows untyped task definitions
  defineTask: <T = any>(config: TaskConfig) => Task<T>
  abortTaskController: AbortTaskController
  getRuntimeSnapshot: () => RuntimeSnapshot
  subscribeRuntimeSnapshot: (
    listener: (snapshot: RuntimeSnapshot) => void,
    options?: RuntimeSnapshotSubscriptionOptions
  ) => () => void
}

type RegisteredTask = {
  registryId: string
  taskId: string
  taskName?: string
  type: TaskType
  init: InitMode
  poolSize?: number
  executor: TaskExecutor
}

const createRegistry = () => {
  const registry = new Map<string, RegisteredTask>()
  let registryCounter = 0

  const registerTask = (entry: Omit<RegisteredTask, 'registryId'>): (() => void) => {
    const registryId = `runtime-task-${registryCounter++}`
    registry.set(registryId, { registryId, ...entry })
    return () => {
      registry.delete(registryId)
    }
  }

  const getRuntimeSnapshot = (): RuntimeSnapshot => {
    const tasks: RuntimeTaskSnapshot[] = []
    for (const entry of registry.values()) {
      const state = entry.executor.getState()
      tasks.push({
        ...state,
        taskId: entry.taskId,
        taskName: entry.taskName,
        init: entry.init,
        poolSize: state.poolSize ?? entry.poolSize,
        type: entry.type,
      })
    }
    return { tasks }
  }

  const subscribeRuntimeSnapshot = (
    listener: (snapshot: RuntimeSnapshot) => void,
    options: RuntimeSnapshotSubscriptionOptions = {}
  ): (() => void) => {
    const intervalMs = options.intervalMs ?? 250
    const emitImmediately = options.emitImmediately ?? true
    const onlyOnChange = options.onlyOnChange ?? false
    let stopped = false
    let lastSnapshotJson: string | null = null

    const emit = () => {
      if (stopped) return
      const snapshot = getRuntimeSnapshot()
      if (onlyOnChange) {
        const json = JSON.stringify(snapshot)
        if (json === lastSnapshotJson) return
        lastSnapshotJson = json
      }
      listener(snapshot)
    }

    if (emitImmediately) {
      emit()
    }

    const intervalId = setInterval(emit, intervalMs)
    return () => {
      stopped = true
      clearInterval(intervalId)
    }
  }

  return { registerTask, getRuntimeSnapshot, subscribeRuntimeSnapshot }
}

export const createTaskRuntime = (): TaskRuntime => {
  const registry = createRegistry()
  const abortTaskController = createAbortTaskController()
  const defineTask = createDefineTask({
    registerTask: registry.registerTask,
    abortTaskController,
  })

  return {
    defineTask,
    abortTaskController,
    getRuntimeSnapshot: registry.getRuntimeSnapshot,
    subscribeRuntimeSnapshot: registry.subscribeRuntimeSnapshot,
  }
}
