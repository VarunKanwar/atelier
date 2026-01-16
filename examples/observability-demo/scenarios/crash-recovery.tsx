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
import type { CrashPolicy } from '../../../src/types'
import RuntimeSnapshotPanel from '../RuntimeSnapshotPanel'
import { useRuntimeEvents } from '../useRuntimeEvents'
import RuntimeEventsPanel from '../harness/RuntimeEventsPanel'
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

const crashPolicies: { label: string; value: CrashPolicy }[] = [
  { label: 'Restart + fail in-flight', value: 'restart-fail-in-flight' },
  { label: 'Restart + requeue in-flight', value: 'restart-requeue-in-flight' },
  { label: 'Fail task', value: 'fail-task' },
]

const CrashRecoveryScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(
    () => createTaskRuntime({ observability: { spans: 'off' } }),
    []
  )
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [batchSize, setBatchSize] = useState(24)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [crashPolicy, setCrashPolicy] = useState<CrashPolicy>('restart-requeue-in-flight')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [results, setResults] = useState<ResultItem[]>([])
  const [crashArmed, setCrashArmed] = useState(false)
  const runIdRef = useRef(0)
  const crashRequestedRef = useRef(false)
  const { stats } = useRuntimeEvents(runtime)
  const crashPolicyCollection = useMemo(
    () =>
      createListCollection({
        items: crashPolicies,
      }),
    []
  )

  const buildTasks = useCallback(() => {
    disposeImagePipelineTasks(tasksRef.current)
    tasksRef.current = createImagePipelineTasks(runtime, {
      analyze: {
        crashPolicy,
        crashMaxRetries: 2,
      },
    })
  }, [crashPolicy, runtime])

  if (!tasksRef.current) {
    tasksRef.current = createImagePipelineTasks(runtime, {
      analyze: {
        crashPolicy,
        crashMaxRetries: 2,
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
    crashRequestedRef.current = false
    setCrashArmed(false)
  }, [buildTasks])

  const handleRun = useCallback(async () => {
    if (status === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 24, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)

    setStatus('running')
    setCompleted(0)
    setFailed(0)
    setResults([])
    setCrashArmed(crashRequestedRef.current)

    const images = generateImages(resolvedBatch)

    try {
      for await (const result of runImagePipeline({
        tasks,
        images,
        concurrencyLimit: resolvedLimit,
        beforeStage: async stage => {
          if (stage !== 'analyze') return
          if (!crashRequestedRef.current) return
          crashRequestedRef.current = false
          setCrashArmed(false)
          await tasks.analyze.crashNext()
        },
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
      }
    }
  }, [batchSize, concurrencyLimit, status])

  const handleCrashNext = useCallback(() => {
    const tasks = tasksRef.current
    if (!tasks) return
    crashRequestedRef.current = true
    setCrashArmed(true)
  }, [])

  const controls = (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
      <Stack gap={4}>
        <ScenarioTabs />
        <Stack gap={1}>
          <Text fontWeight="semibold">Crash policy</Text>
          <Text fontSize="sm" color="gray.600">
            Inject a crash and see how the executor responds.
          </Text>
        </Stack>

        <Box>
          <Text fontSize="xs" color="gray.500" mb={1}>
            Crash policy (analyze worker)
          </Text>
          <Select.Root
            size="sm"
            value={[crashPolicy]}
            onValueChange={event => {
              const next = event.value[0] as CrashPolicy | undefined
              if (next) setCrashPolicy(next)
            }}
            collection={crashPolicyCollection}
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
                  {crashPolicies.map(item => (
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
            Restart tasks to apply policy changes.
          </Text>
        </Box>

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

        <HStack gap={2} fontSize="xs" color="gray.500">
          <Text>Crashes: {stats.counters['worker.crash.total'] ?? 0}</Text>
          <Text>Requeued: {stats.counters['task.requeue.total'] ?? 0}</Text>
        </HStack>

        {crashArmed ? (
          <Text fontSize="xs" color="orange.600">
            Crash armed — the next analyze call will trigger a worker crash.
          </Text>
        ) : null}

        <HStack gap={2}>
          <Button onClick={handleRun} disabled={status === 'running'} colorScheme="blue">
            {status === 'running' ? 'Running…' : 'Run'}
          </Button>
          <Button variant="outline" onClick={handleCrashNext}>
            Crash next analyze call
          </Button>
        </HStack>
        <Button variant="outline" onClick={handleRestartTasks}>
          Restart tasks
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
          <Text>Completed / failed</Text>
          <Text fontWeight="semibold">
            {completed} / {failed}
          </Text>
        </HStack>
        {results.length === 0 ? (
          <Text fontSize="sm" color="gray.500">
            Run the scenario, then inject a crash to see recovery behavior.
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
          1. Select a crash policy and restart tasks.
        </Text>
        <Text fontSize="sm" color="gray.600">
          2. Inject a crash while work is in-flight.
        </Text>
        <Text fontSize="sm" color="gray.600">
          3. Compare requeue vs fail-in-flight counters.
        </Text>
      </Stack>
    </Box>
  )

  return (
    <ScenarioShell
      title="Crash recovery"
      summary="Trigger a worker crash and see how the executor recovers."
      goal="Compare crash policies and how in-flight work is handled."
      controls={controls}
      rightPanel={
        <Stack gap={4}>
          <RuntimeSnapshotPanel runtime={runtime} onlyOnChange graph={graph} />
          <RuntimeEventsPanel runtime={runtime} />
        </Stack>
      }
      results={resultsPanel}
      notes={notes}
    />
  )
}

export const crashRecoveryScenario: ScenarioDefinition = {
  meta: {
    id: 'crash-recovery',
    title: 'Crash recovery',
    summary: 'Inject worker crashes and compare recovery policies.',
    goal: 'Understand requeue vs fail-in-flight semantics.',
  },
  Component: CrashRecoveryScenario,
}
