import {
  Badge,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createTaskRuntime } from '../../../src'
import type { QueuePolicy } from '../../../src/types'
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
import { clampNumber } from './utils'
import type { ScenarioComponentProps, ScenarioDefinition } from './types'

type RunStatus = 'idle' | 'running' | 'done'

type ResultItem = {
  id: string
  status: 'fulfilled' | 'rejected'
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

const queuePolicies: { label: string; value: QueuePolicy }[] = [
  { label: 'Block (default)', value: 'block' },
  { label: 'Reject', value: 'reject' },
  { label: 'Drop latest', value: 'drop-latest' },
  { label: 'Drop oldest', value: 'drop-oldest' },
]

const BackpressureScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(
    () => createTaskRuntime({ observability: { spans: 'off' } }),
    []
  )
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [queuePolicy, setQueuePolicy] = useState<QueuePolicy>('block')
  const [maxQueueDepth, setMaxQueueDepth] = useState(18)
  const [batchSize, setBatchSize] = useState(30)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [results, setResults] = useState<ResultItem[]>([])
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
    setStatus('idle')
    setResults([])
    setCompleted(0)
    setFailed(0)
    setStartedAt(null)
    setFinishedAt(null)
  }, [buildTasks])

  const handleRun = useCallback(async () => {
    if (status === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 30, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)

    setStatus('running')
    setCompleted(0)
    setFailed(0)
    setResults([])
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
          setFailed(prev => prev + 1)
          const message = result.error instanceof Error ? result.error.message : String(result.error)
          setResults(prev =>
            [
              {
                id: result.item.name,
                status: 'rejected',
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
        setFinishedAt(Date.now())
      }
    }
  }, [batchSize, concurrencyLimit, status])

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
    <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
      <Stack gap={4}>
        <ScenarioTabs />
        <Stack gap={1}>
          <Text fontWeight="semibold">Workload</Text>
          <Text fontSize="sm" color="gray.600">
            Increase concurrency to apply pressure on the bottleneck queue.
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

        <Stack gap={2}>
          <Text fontWeight="semibold">Bottleneck queue</Text>
          <Text fontSize="xs" color="gray.500">
            Applies to the singleton analyze worker.
          </Text>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Max queue depth
            </Text>
            <Input
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
            <Text fontSize="xs" color="gray.500" mt={2}>
              Restart tasks to apply queue policy changes.
            </Text>
          </Box>
        </Stack>

        <HStack gap={2}>
          <Button onClick={handleRun} disabled={status === 'running'} colorScheme="blue">
            {status === 'running' ? 'Running…' : 'Run'}
          </Button>
          <Button variant="outline" onClick={handleRestartTasks}>
            Restart tasks
          </Button>
        </HStack>
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
          <Text>Completed / failed</Text>
          <Text fontWeight="semibold">
            {completed} / {failed}
          </Text>
        </HStack>
        <HStack justify="space-between" fontSize="sm" color="gray.600">
          <Text>Duration</Text>
          <Text fontWeight="semibold">{(durationMs / 1000).toFixed(1)}s</Text>
        </HStack>
        <HStack justify="space-between" fontSize="sm" color="gray.600">
          <Text>Throughput</Text>
          <Text fontWeight="semibold">{throughput ? `${throughput.toFixed(2)} img/s` : '—'}</Text>
        </HStack>
        {results.length === 0 ? (
          <Text fontSize="sm" color="gray.500">
            Run the scenario to see recent completions.
          </Text>
        ) : (
          <Stack gap={2}>
            {results.map(result => (
              <HStack key={result.id} justify="space-between">
                <Text fontSize="sm" color="gray.700">
                  {result.message}
                </Text>
                <Badge
                  bg={result.status === 'fulfilled' ? 'green.50' : 'red.50'}
                  color={result.status === 'fulfilled' ? 'green.700' : 'red.700'}
                >
                  {result.status === 'fulfilled' ? 'ok' : 'error'}
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
          1. Raise pipeline concurrency above 6.
        </Text>
        <Text fontSize="sm" color="gray.600">
          2. Lower max queue depth to force drops.
        </Text>
        <Text fontSize="sm" color="gray.600">
          3. Switch policy to drop-latest or reject and observe pending counts.
        </Text>
      </Stack>
    </Box>
  )

  return (
    <ScenarioShell
      title="Backpressure 101"
      summary="See how a bottlenecked worker queue absorbs load and how queue policies behave under pressure."
      goal="Understand queue depth, pending vs blocked work, and policy tradeoffs."
      controls={controls}
      rightPanel={<RuntimeSnapshotPanel runtime={runtime} onlyOnChange graph={graph} />}
      results={resultsPanel}
      notes={notes}
    />
  )
}

export const backpressureScenario: ScenarioDefinition = {
  meta: {
    id: 'backpressure',
    title: 'Backpressure 101',
    summary: 'Explore queue depth and policies under a real bottleneck.',
    goal: 'See pending vs blocked work and how queue policies respond.',
  },
  Component: BackpressureScenario,
}
