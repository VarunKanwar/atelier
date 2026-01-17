export class WorkerCrashedError extends Error {
  readonly taskId: string
  readonly workerIndex?: number
  readonly cause?: unknown

  constructor(taskId: string, workerIndex?: number, cause?: unknown) {
    super(`Worker crashed for task '${taskId}'`)
    this.name = 'WorkerCrashedError'
    this.taskId = taskId
    this.workerIndex = workerIndex
    this.cause = cause
  }
}
