import { afterEach, describe, expect, it, vi } from 'vitest'

const pushTransferable = (value: unknown, transferables: Transferable[]) => {
  if (value instanceof ArrayBuffer) {
    transferables.push(value)
    return
  }
  if (value && typeof value === 'object' && 'buffer' in value) {
    const buffer = (value as { buffer?: unknown }).buffer
    if (buffer instanceof ArrayBuffer) {
      transferables.push(buffer)
    }
  }
}

const detectTransferables = (obj: unknown): Transferable[] => {
  const transferables: Transferable[] = []
  if (!obj || typeof obj !== 'object') {
    return transferables
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      pushTransferable(item, transferables)
    }
    return transferables
  }
  for (const value of Object.values(obj as Record<string, unknown>)) {
    pushTransferable(value, transferables)
  }
  return transferables
}

const { mockTransfer, mockGetTransferables } = vi.hoisted(() => {
  const mockTransfer = vi.fn((obj, _transferables) => obj)
  const mockGetTransferables = vi.fn((obj: unknown) => detectTransferables(obj))

  return { mockTransfer, mockGetTransferables }
})

// Mock comlink with transfer support
vi.mock('comlink', () => ({
  wrap: (worker: unknown) => worker,
  transfer: mockTransfer,
}))

// Mock transferables library
vi.mock('transferables', () => ({
  getTransferables: mockGetTransferables,
}))

import { createTaskRuntime } from '../../src/runtime'
import { type DispatchHandler, FakeWorker } from '../helpers/fake-worker'

type TransferTestAPI = {
  processBuffer: (data: Uint8Array) => Promise<Uint8Array>
  processWithMetadata: (buffer: ArrayBuffer, metadata: object) => Promise<ArrayBuffer>
}

const makeWorkerFactory = (dispatches: DispatchHandler[]) => {
  const created: FakeWorker[] = []
  const createWorker = () => {
    const dispatch = dispatches.shift()
    if (!dispatch) {
      throw new Error('No dispatch handler available')
    }
    const worker = new FakeWorker(dispatch)
    created.push(worker)
    return worker as unknown as Worker
  }
  return { createWorker, created }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('Transferables', () => {
  describe('auto-detection', () => {
    it('auto-detects and transfers ArrayBuffer in singleton task', async () => {
      const runtime = createTaskRuntime()
      const buffer = new ArrayBuffer(1024)
      const data = new Uint8Array(buffer)

      const { createWorker } = makeWorkerFactory([
        async (_callId, _method, args) => {
          // Return the same data
          return args[0]
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      const result = await task.processBuffer(data)

      // Verify getTransferables was called with the args array
      expect(mockGetTransferables).toHaveBeenCalled()

      // Verify transfer was called with detected transferables
      expect(mockTransfer).toHaveBeenCalled()
      const transferCalls = mockTransfer.mock.calls
      expect(transferCalls.length).toBeGreaterThan(0)

      expect(result).toBe(data)
    })

    it('auto-detects and transfers ArrayBuffer in parallel task', async () => {
      const runtime = createTaskRuntime()
      const buffer = new ArrayBuffer(2048)
      const data = new Uint8Array(buffer)

      const { createWorker } = makeWorkerFactory([
        async (_callId, _method, args) => {
          return args[0]
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'parallel',
        poolSize: 1,
        worker: createWorker,
      })

      const result = await task.processBuffer(data)

      expect(mockGetTransferables).toHaveBeenCalled()
      expect(mockTransfer).toHaveBeenCalled()
      expect(result).toBe(data)
    })

    it('auto-detects transferables in result and transfers back', async () => {
      const runtime = createTaskRuntime()
      const inputBuffer = new ArrayBuffer(512)
      const outputBuffer = new ArrayBuffer(1024)
      const outputData = new Uint8Array(outputBuffer)

      const { createWorker } = makeWorkerFactory([
        async () => {
          return outputData
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      const result = await task.processBuffer(new Uint8Array(inputBuffer))

      // Should call getTransferables twice: once for args, once for result
      expect(mockGetTransferables).toHaveBeenCalledTimes(2)

      // Should call transfer at least once for args
      expect(mockTransfer).toHaveBeenCalled()

      expect(result).toBe(outputData)
    })
  })

  describe('explicit transfer control', () => {
    it('uses explicit transfer list when provided', async () => {
      const runtime = createTaskRuntime()
      const buffer1 = new ArrayBuffer(1024)
      const buffer2 = new ArrayBuffer(2048)

      const { createWorker } = makeWorkerFactory([
        async (_callId, _method, _args) => {
          // Return a simple value without transferables
          return { success: true }
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      // Explicitly transfer only buffer2
      const result = await task
        .with({
          transfer: [buffer2],
          transferResult: false, // Disable result transfer to isolate args behavior
        })
        .processWithMetadata(buffer1, { extra: buffer2 })

      // getTransferables should NOT be called since we have explicit transfer for args
      // and disabled transfer for result
      expect(mockGetTransferables).not.toHaveBeenCalled()

      // transfer should be called once for args with the explicit list
      expect(mockTransfer).toHaveBeenCalledTimes(1)
      expect(mockTransfer).toHaveBeenCalledWith(expect.any(Array), [buffer2])

      expect(result).toBeDefined()
    })

    it('disables transfer when empty array is provided', async () => {
      const runtime = createTaskRuntime()
      const buffer = new ArrayBuffer(1024)
      const data = new Uint8Array(buffer)

      const { createWorker } = makeWorkerFactory([
        async (_callId, _method, _args) => {
          // Return simple value
          return { success: true }
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      const result = await task
        .with({
          transfer: [],
          transferResult: false,
        })
        .processBuffer(data)

      // getTransferables should NOT be called since we disabled both args and result transfer
      expect(mockGetTransferables).not.toHaveBeenCalled()

      // transfer should NOT be called at all
      expect(mockTransfer).not.toHaveBeenCalled()

      expect(result).toBeDefined()
    })
  })

  describe('transferResult option', () => {
    it('transfers result by default', async () => {
      const runtime = createTaskRuntime()
      const inputBuffer = new ArrayBuffer(512)
      const outputBuffer = new ArrayBuffer(1024)
      const outputData = new Uint8Array(outputBuffer)

      const { createWorker } = makeWorkerFactory([
        async () => {
          return outputData
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      await task.processBuffer(new Uint8Array(inputBuffer))

      // Should detect transferables in both args and result
      expect(mockGetTransferables).toHaveBeenCalledTimes(2)
      // transfer may be called 1-2 times depending on whether args/result have transferables
      expect(mockTransfer).toHaveBeenCalled()
    })

    it('does not transfer result when transferResult is false', async () => {
      const runtime = createTaskRuntime()
      const inputBuffer = new ArrayBuffer(512)
      const outputBuffer = new ArrayBuffer(1024)
      const outputData = new Uint8Array(outputBuffer)

      const { createWorker } = makeWorkerFactory([
        async () => {
          return outputData
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      await task.with({ transferResult: false }).processBuffer(new Uint8Array(inputBuffer))

      // With transferResult: false, should only detect transferables in args (not result)
      // This is efficient - we don't waste time detecting if we're not going to transfer
      expect(mockGetTransferables).toHaveBeenCalledTimes(1)

      // transfer should only be called for args (if they have transferables)
      expect(mockTransfer).toHaveBeenCalled()
    })

    it('does not transfer null or undefined results', async () => {
      const runtime = createTaskRuntime()
      const inputBuffer = new ArrayBuffer(512)

      const { createWorker } = makeWorkerFactory([
        async () => {
          return null
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      const result = await task.processBuffer(new Uint8Array(inputBuffer))

      // Should only detect transferables in args, not result (since it's null)
      expect(mockGetTransferables).toHaveBeenCalledTimes(1)
      expect(mockTransfer).toHaveBeenCalledTimes(1)
      expect(result).toBeNull()
    })
  })

  describe('combined options', () => {
    it('respects both explicit transfer and transferResult options', async () => {
      const runtime = createTaskRuntime()
      const buffer = new ArrayBuffer(1024)
      const outputBuffer = new ArrayBuffer(2048)
      const outputData = new Uint8Array(outputBuffer)

      const { createWorker } = makeWorkerFactory([
        async () => {
          return outputData
        },
      ])

      const task = runtime.defineTask<TransferTestAPI>({
        type: 'singleton',
        worker: createWorker,
      })

      mockGetTransferables.mockClear()
      mockTransfer.mockClear()

      await task
        .with({
          transfer: [buffer],
          transferResult: false,
        })
        .processWithMetadata(buffer, {})

      // With explicit transfer, getTransferables may still be called for result detection
      // but since transferResult: false, result won't be transferred

      // transfer should be called for the explicit args transfer
      expect(mockTransfer).toHaveBeenCalled()
      const argsCall = mockTransfer.mock.calls.find(call => call[1]?.includes(buffer))
      expect(argsCall).toBeDefined()
    })
  })
})
