import { Box, Button, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createTaskRuntime } from '../../../src'
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
import { clampNumber } from './utils'

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

const Divider = () => <Box borderTopWidth="1px" borderColor="gray.200" />

const ConcurrencyScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(() => createTaskRuntime({ observability: { spans: 'off' } }), [])
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [batchSize, setBatchSize] = useState(30)
  const [concurrencyLimit, setConcurrencyLimit] = useState(4)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const runIdRef = useRef(0)

  if (!tasksRef.current) {
    tasksRef.current = createImagePipelineTasks(runtime, {})
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
    const resolvedBatch = clampNumber(batchSize, 30, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 4, 1, 64)

    setRunStatus('running')
    setCompleted(0)
    setFailed(0)
    setStartedAt(Date.now())
    setFinishedAt(null)

    const images = generateImages(resolvedBatch)

    try {
      for await (const result of runImagePipeline({
        tasks,
        images,
        concurrencyLimit: resolvedLimit,
      })) {
        if (runIdRef.current !== runId) break
        if (result.status === 'fulfilled') {
          setCompleted(prev => prev + 1)
        } else {
          setFailed(prev => prev + 1)
        }
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunStatus('done')
        setFinishedAt(Date.now())
      }
    }
  }, [batchSize, concurrencyLimit, runStatus])

  const durationMs = useMemo(() => {
    if (!startedAt) return 0
    const end = finishedAt ?? Date.now()
    return Math.max(0, end - startedAt)
  }, [finishedAt, startedAt])

  const throughput = useMemo(() => {
    if (!finishedAt || durationMs === 0) return null
    const seconds = durationMs / 1000
    return seconds > 0 ? completed / seconds : null
  }, [completed, durationMs, finishedAt])

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
              Concurrency limit
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
        <Button
          size="sm"
          onClick={handleRun}
          disabled={runStatus === 'running'}
          colorScheme="blue"
          w="full"
        >
          {runStatus === 'running' ? 'Running…' : 'Run'}
        </Button>
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
        <Text>Failed</Text>
        <Text fontWeight="semibold" color="gray.800">
          {failed}
        </Text>
      </HStack>
      <HStack gap={2}>
        <Text>Duration</Text>
        <Text fontWeight="semibold" color="gray.800">
          {(durationMs / 1000).toFixed(1)}s
        </Text>
      </HStack>
      {throughput !== null && (
        <HStack gap={2}>
          <Text>Throughput</Text>
          <Text fontWeight="semibold" color="gray.800">
            {throughput.toFixed(1)} img/s
          </Text>
        </HStack>
      )}
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

export const concurrencyScenario: ScenarioDefinition = {
  meta: {
    id: 'concurrency',
    title: 'Pipeline concurrency',
    summary: 'Control throughput with parallelLimit.',
  },
  Component: ConcurrencyScenario,
}
