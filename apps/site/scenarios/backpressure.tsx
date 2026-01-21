import {
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Portal,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react'
import type { QueuePolicy } from '@varunkanwar/atelier'

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

const queuePolicies: { label: string; value: QueuePolicy }[] = [
  { label: 'Block (call-site wait)', value: 'block' },
  { label: 'Reject', value: 'reject' },
  { label: 'Drop latest', value: 'drop-latest' },
  { label: 'Drop oldest', value: 'drop-oldest' },
]

const BackpressureScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(() => createTaskRuntime({ observability: { spans: 'off' } }), [])
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [queuePolicy, setQueuePolicy] = useState<QueuePolicy>('block')
  const [maxQueueDepth, setMaxQueueDepth] = useState(18)
  const [batchSize, setBatchSize] = useState(30)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const runIdRef = useRef(0)
  const queuePolicyCollection = useMemo(
    () =>
      createListCollection({
        items: queuePolicies,
      }),
    []
  )

  const buildTasks = useCallback(() => {
    disposeImagePipelineTasks(tasksRef.current)
    tasksRef.current = createImagePipelineTasks(runtime, {
      analyze: {
        queuePolicy,
        maxQueueDepth,
      },
    })
  }, [maxQueueDepth, queuePolicy, runtime])

  if (!tasksRef.current) {
    tasksRef.current = createImagePipelineTasks(runtime, {
      analyze: {
        queuePolicy,
        maxQueueDepth,
      },
    })
  }

  useEffect(() => {
    return () => {
      disposeImagePipelineTasks(tasksRef.current)
    }
  }, [])

  const handleRestartTasks = useCallback(() => {
    buildTasks()
    setRunStatus('idle')
    setCompleted(0)
    setFailed(0)
    setStartedAt(null)
    setFinishedAt(null)
  }, [buildTasks])

  const handleRun = useCallback(async () => {
    if (runStatus === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 30, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)

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
        <Stack gap={3}>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Max queue depth
            </Text>
            <Input
              size="sm"
              type="number"
              value={maxQueueDepth}
              min={1}
              max={100}
              onChange={event => setMaxQueueDepth(Number(event.target.value))}
            />
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Queue policy
            </Text>
            <Select.Root
              size="sm"
              value={[queuePolicy]}
              onValueChange={event => {
                const next = event.value[0] as QueuePolicy | undefined
                if (next) setQueuePolicy(next)
              }}
              collection={queuePolicyCollection}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="Select policy" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {queuePolicies.map(item => (
                      <Select.Item key={item.value} item={item}>
                        {item.label}
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </Box>
        </Stack>
      </Box>

      <Divider />

      <Box p={4}>
        <HStack gap={2}>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={runStatus === 'running'}
            colorPalette="blue"
          >
            {runStatus === 'running' ? 'Running…' : 'Run'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleRestartTasks}>
            Restart
          </Button>
        </HStack>
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

export const backpressureScenario: ScenarioDefinition = {
  meta: {
    id: 'queue-policies',
    title: 'Queue policies',
    summary: 'Explore queue depth and policies under backpressure.',
  },
  Component: BackpressureScenario,
}
