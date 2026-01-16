import { Badge, Box, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createTaskRuntime } from '../../../src'
import RuntimeSnapshotPanel from '../RuntimeSnapshotPanel'
import type { FlowGraph } from '../harness/flow-types'
import ScenarioShell from '../harness/ScenarioShell'
import ScenarioTabs from '../harness/ScenarioTabs'
import {
  createImagePipelineTasks,
  disposeImagePipelineTasks,
  generateImages,
  runImagePipeline,
  type PipelineTasks,
} from '../workflows/image-pipeline'
import { clampNumber, isAbortError } from './utils'
import type { ScenarioComponentProps, ScenarioDefinition } from './types'

type RunStatus = 'idle' | 'running' | 'done'

type ResultItem = {
  id: string
  status: 'fulfilled' | 'rejected' | 'canceled'
  message: string
}

const graph: FlowGraph = {
  nodes: [
    { id: 'resize', taskId: 'resize', label: 'Resize', kind: 'parallel' },
    { id: 'analyze', taskId: 'analyze', label: 'Analyze', kind: 'singleton' },
    { id: 'enhance', taskId: 'enhance', label: 'Enhance', kind: 'singleton' },
  ],
  edges: [
    { from: 'resize', to: 'analyze', label: 'queue' },
    { from: 'analyze', to: 'enhance', label: 'queue' },
  ],
  order: ['resize', 'analyze', 'enhance'],
}

const CancellationScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(
    () => createTaskRuntime({ observability: { spans: 'off' } }),
    []
  )
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [batchSize, setBatchSize] = useState(28)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [canceled, setCanceled] = useState(0)
  const [results, setResults] = useState<ResultItem[]>([])
  const [runKey, setRunKey] = useState<string | null>(null)
  const [isArmed, setIsArmed] = useState(false)
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
    if (status === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 28, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)
    const nextKey = `cancel-run-${runId}`

    runtime.abortTaskController.clear(nextKey)
    const signal = runtime.abortTaskController.signalFor(nextKey)
    setRunKey(nextKey)
    setIsArmed(false)
    setStatus('running')
    setCompleted(0)
    setFailed(0)
    setCanceled(0)
    setResults([])

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
          setResults(prev =>
            [
              {
                id: result.item.name,
                status: 'fulfilled',
                message: `${result.item.name}: ${result.value.objects.join(', ')}`,
              },
              ...prev,
            ].slice(0, 6)
          )
        } else {
          const isCanceled = isAbortError(result.error)
          if (isCanceled) {
            setCanceled(prev => prev + 1)
          } else {
            setFailed(prev => prev + 1)
          }
          const message = result.error instanceof Error ? result.error.message : String(result.error)
          setResults(prev =>
            [
              {
                id: result.item.name,
                status: isCanceled ? 'canceled' : 'rejected',
                message: `${result.item.name}: ${message}`,
              },
              ...prev,
            ].slice(0, 6)
          )
        }
      }
    } finally {
      if (runIdRef.current === runId) {
        setStatus('done')
      }
    }
  }, [batchSize, concurrencyLimit, runtime, status])

  const handleAbort = useCallback(() => {
    if (!runKey) return
    runtime.abortTaskController.abort(runKey)
    setIsArmed(true)
  }, [runKey, runtime])

  const handleClear = useCallback(() => {
    if (!runKey) return
    runtime.abortTaskController.clear(runKey)
    setRunKey(null)
    setIsArmed(false)
  }, [runKey, runtime])

  const controls = (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
      <Stack gap={4}>
        <ScenarioTabs />
        <Stack gap={1}>
          <Text fontWeight="semibold">Workload</Text>
          <Text fontSize="sm" color="gray.600">
            Start a run and abort it while the queue is backed up.
          </Text>
        </Stack>

        <Stack gap={3}>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Batch size
            </Text>
            <Input
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
              type="number"
              value={concurrencyLimit}
              min={1}
              max={64}
              onChange={event => setConcurrencyLimit(Number(event.target.value))}
            />
          </Box>
        </Stack>

        <HStack gap={2}>
          <Button onClick={handleRun} disabled={status === 'running'} colorScheme="blue">
            {status === 'running' ? 'Running…' : 'Run'}
          </Button>
          <Button
            variant="outline"
            onClick={handleAbort}
            disabled={!runKey || status !== 'running'}
          >
            Abort run
          </Button>
        </HStack>
        <Stack gap={2} fontSize="xs" color="gray.500">
          <Text>Cancellation uses a keyed AbortTaskController signal.</Text>
          <Text>
            Active key: <Text as="span">{runKey ?? '—'}</Text>
          </Text>
          <Text>
            Abort status: <Text as="span">{isArmed ? 'aborted' : 'ready'}</Text>
          </Text>
        </Stack>
        <Button variant="ghost" size="sm" onClick={handleClear} disabled={!runKey}>
          Clear abort key
        </Button>
      </Stack>
    </Box>
  )

  const resultsPanel = (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
      <Stack gap={3}>
        <HStack justify="space-between">
          <Text fontWeight="semibold">Recent results</Text>
          <Badge bg="gray.100" color="gray.700">
            {results.length} shown
          </Badge>
        </HStack>
        <HStack justify="space-between" fontSize="sm" color="gray.600">
          <Text>Completed / canceled / failed</Text>
          <Text fontWeight="semibold">
            {completed} / {canceled} / {failed}
          </Text>
        </HStack>
        {results.length === 0 ? (
          <Text fontSize="sm" color="gray.500">
            Run the scenario, then abort while queues are full.
          </Text>
        ) : (
          <Stack gap={2}>
            {results.map(result => (
              <HStack key={result.id} justify="space-between">
                <Text fontSize="sm" color="gray.700">
                  {result.message}
                </Text>
                <Badge
                  bg={
                    result.status === 'fulfilled'
                      ? 'green.50'
                      : result.status === 'canceled'
                        ? 'orange.50'
                        : 'red.50'
                  }
                  color={
                    result.status === 'fulfilled'
                      ? 'green.700'
                      : result.status === 'canceled'
                        ? 'orange.700'
                        : 'red.700'
                  }
                >
                  {result.status}
                </Badge>
              </HStack>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  )

  const notes = (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
      <Stack gap={2}>
        <Text fontWeight="semibold">What to try</Text>
        <Text fontSize="sm" color="gray.600">
          1. Start a run with a larger batch size.
        </Text>
          <Text fontSize="sm" color="gray.600">
            2. Click “Abort run” while pending {'>'} 0.
          </Text>
        <Text fontSize="sm" color="gray.600">
          3. Watch canceled vs failed results.
        </Text>
      </Stack>
    </Box>
  )

  return (
    <ScenarioShell
      title="Cancellation phases"
      summary="Cancel a keyed workload while items are queued or in flight."
      goal="Observe how queued vs in-flight work is canceled and reported."
      controls={controls}
      rightPanel={<RuntimeSnapshotPanel runtime={runtime} onlyOnChange graph={graph} />}
      results={resultsPanel}
      notes={notes}
    />
  )
}

export const cancellationScenario: ScenarioDefinition = {
  meta: {
    id: 'cancellation',
    title: 'Cancellation phases',
    summary: 'Abort a workload and see queued vs in-flight cancellation.',
    goal: 'Learn how keyed cancellation behaves across the queue and workers.',
  },
  Component: CancellationScenario,
}
