import { describe, expect, it } from 'vitest'
import { createAbortTaskController } from '../../core/abort-task-controller'

describe('AbortTaskController', () => {
  it('aborts and clears per key', () => {
    const controller = createAbortTaskController()
    const signal = controller.signalFor('doc-1')

    expect(signal.aborted).toBe(false)
    expect(controller.isAborted('doc-1')).toBe(false)

    controller.abort('doc-1')
    expect(signal.aborted).toBe(true)
    expect(controller.isAborted('doc-1')).toBe(true)

    controller.clear('doc-1')
    expect(controller.isAborted('doc-1')).toBe(false)
    const newSignal = controller.signalFor('doc-1')
    expect(newSignal).not.toBe(signal)
    expect(newSignal.aborted).toBe(false)
  })

  it('aborts multiple keys', () => {
    const controller = createAbortTaskController()
    const a = controller.signalFor('a')
    const b = controller.signalFor('b')

    controller.abortMany(['a', 'b'])

    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(true)
  })
})
