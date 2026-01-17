import { Box, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { createTaskRuntime } from '@varunkanwar/atelier'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowGraph } from '../harness/flow-types'
import ScenarioShell from '../harness/ScenarioShell'
import RuntimeSnapshotPanel from '../RuntimeSnapshotPanel'
import {
  createImagePipelineTasks,
  disposeImagePipelineTasks,
  generateImages,
  type PipelineTasks,
  runImagePipeline,
} from '../workflows/image-pipeline'
import type { ScenarioComponentProps, ScenarioDefinition } from './types'
import { clampNumber, isAbortError } from './utils'

type RunStatus = 'idle' | 'running' | 'done'

const graph: FlowGraph = {
  nodes: [
    { id: 'source', taskId: 'source', label: 'Source', kind: 'source' },
    { id: 'resize', taskId: 'resize', label: 'Resize', kind: 'parallel' },
    { id: 'analyze', taskId: 'analyze', label: 'Analyze', kind: 'singleton' },
    { id: 'enhance', taskId: 'enhance', label: 'Enhance', kind: 'singleton' },
    { id: 'sink', taskId: 'sink', label: 'External', kind: 'sink' },
  ],
  edges: [
    { from: 'source', to: 'resize', label: 'queue' },
    { from: 'resize', to: 'analyze', label: 'queue' },
    { from: 'analyze', to: 'enhance', label: 'queue' },
    { from: 'enhance', to: 'sink', label: 'downstream', kind: 'external' },
  ],
  order: ['source', 'resize', 'analyze', 'enhance', 'sink'],
}

const CancellationScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(() => createTaskRuntime({ observability: { spans: 'off' } }), [])
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [batchSize, setBatchSize] = useState(28)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [canceled, setCanceled] = useState(0)
  const [runKey, setRunKey] = useState<string | null>(null)
  const runIdRef = useRef(0)

  if (!tasksRef.current) {
    tasksRef.current = createImagePipelineTasks(runtime, {
      analyze: { maxQueueDepth: 10, queuePolicy: 'block' },
    })
  }

  useEffect(() => {
    return () => {
      disposeImagePipelineTasks(tasksRef.current)
    }
  }, [])

  const handleRun = useCallback(async () => {
    if (runStatus === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 28, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)
    const nextKey = `cancel-run-${runId}`

    runtime.abortTaskController.clear(nextKey)
    const signal = runtime.abortTaskController.signalFor(nextKey)
    setRunKey(nextKey)
    setRunStatus('running')
    setCompleted(0)
    setFailed(0)
    setCanceled(0)

    const images = generateImages(resolvedBatch)

    try {
      for await (const result of runImagePipeline({
        tasks,
        images,
        concurrencyLimit: resolvedLimit,
        dispatchOptions: { key: nextKey, signal },
      })) {
        if (runIdRef.current !== runId) break
        if (result.status === 'fulfilled') {
          setCompleted(prev => prev + 1)
        } else {
          const isCanceled = isAbortError(result.error)
          if (isCanceled) {
            setCanceled(prev => prev + 1)
          } else {
            setFailed(prev => prev + 1)
          }
        }
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunStatus('done')
      }
    }
  }, [batchSize, concurrencyLimit, runtime, runStatus])

  const handleAbort = useCallback(() => {
    if (!runKey) return
    runtime.abortTaskController.abort(runKey)
  }, [runKey, runtime])

  const Divider = () => <Box borderTopWidth="1px" borderColor="gray.200" />

  const controls = (
    <Stack gap={0}>
      <Box p={4}>
        <Stack gap={3}>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Batch size
            </Text>
            <Input
              size="sm"
              type="number"
              value={batchSize}
              min={1}
              max={200}
              onChange={event => setBatchSize(Number(event.target.value))}
            />
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Pipeline concurrency
            </Text>
            <Input
              size="sm"
              type="number"
              value={concurrencyLimit}
              min={1}
              max={64}
              onChange={event => setConcurrencyLimit(Number(event.target.value))}
            />
          </Box>
        </Stack>
      </Box>

      <Divider />

      <Box p={4}>
        <HStack gap={2} mb={3}>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={runStatus === 'running'}
            colorScheme="blue"
          >
            {runStatus === 'running' ? 'Running…' : 'Run'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAbort}
            disabled={!runKey || runStatus !== 'running'}
          >
            Abort
          </Button>
        </HStack>
        <Text fontSize="xs" color="gray.500">
          Key: {runKey ?? '—'}
        </Text>
      </Box>
    </Stack>
  )

  const status = (
    <HStack gap={6} fontSize="sm" color="gray.600">
      <HStack gap={2}>
        <Text>Completed</Text>
        <Text fontWeight="semibold" color="gray.800">
          {completed}
        </Text>
      </HStack>
      <HStack gap={2}>
        <Text>Canceled</Text>
        <Text fontWeight="semibold" color="orange.600">
          {canceled}
        </Text>
      </HStack>
      <HStack gap={2}>
        <Text>Failed</Text>
        <Text fontWeight="semibold" color="gray.800">
          {failed}
        </Text>
      </HStack>
    </HStack>
  )

  return (
    <ScenarioShell
      controls={controls}
      main={<RuntimeSnapshotPanel runtime={runtime} onlyOnChange graph={graph} />}
      status={status}
    />
  )
}

export const cancellationScenario: ScenarioDefinition = {
  meta: {
    id: 'cancellation',
    title: 'Cancellation',
    summary: 'Abort a workload and see queued vs in-flight cancellation.',
  },
  Component: CancellationScenario,
}
