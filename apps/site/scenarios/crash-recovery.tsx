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
import type { CrashPolicy } from '@varunkanwar/atelier'

import { createTaskRuntime } from '@varunkanwar/atelier'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowGraph } from '../harness/flow-types'
import ScenarioShell from '../harness/ScenarioShell'
import RuntimeSnapshotPanel from '../RuntimeSnapshotPanel'
import { useRuntimeEvents } from '../useRuntimeEvents'
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

const crashPolicies: { label: string; value: CrashPolicy }[] = [
  { label: 'Restart + fail in-flight', value: 'restart-fail-in-flight' },
  { label: 'Restart + requeue', value: 'restart-requeue-in-flight' },
  { label: 'Fail task', value: 'fail-task' },
]

const CrashRecoveryScenario = (_props: ScenarioComponentProps) => {
  const runtime = useMemo(() => createTaskRuntime({ observability: { spans: 'off' } }), [])
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [batchSize, setBatchSize] = useState(24)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [crashPolicy, setCrashPolicy] = useState<CrashPolicy>('restart-requeue-in-flight')
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
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
    setRunStatus('idle')
    setCompleted(0)
    setFailed(0)
    crashRequestedRef.current = false
    setCrashArmed(false)
  }, [buildTasks])

  const handleRun = useCallback(async () => {
    if (runStatus === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 24, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)

    setRunStatus('running')
    setCompleted(0)
    setFailed(0)
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
        } else {
          setFailed(prev => prev + 1)
        }
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunStatus('done')
      }
    }
  }, [batchSize, concurrencyLimit, runStatus])

  const handleCrashNext = useCallback(() => {
    const tasks = tasksRef.current
    if (!tasks) return
    crashRequestedRef.current = true
    setCrashArmed(true)
  }, [])

  const Divider = () => <Box borderTopWidth="1px" borderColor="gray.200" />

  const controls = (
    <Stack gap={0}>
      <Box p={4}>
        <Stack gap={3}>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Crash policy
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
          </Box>
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
        {crashArmed && (
          <Text fontSize="xs" color="orange.600" mb={3}>
            Crash armed — next analyze call will crash.
          </Text>
        )}
        <HStack gap={2}>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={runStatus === 'running'}
            colorScheme="blue"
          >
            {runStatus === 'running' ? 'Running…' : 'Run'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCrashNext}>
            Crash next
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
        <Text>Crashes</Text>
        <Text fontWeight="semibold" color="orange.600">
          {stats.counters['worker.crash.total'] ?? 0}
        </Text>
      </HStack>
      <HStack gap={2}>
        <Text>Requeued</Text>
        <Text fontWeight="semibold" color="gray.800">
          {stats.counters['task.requeue.total'] ?? 0}
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

export const crashRecoveryScenario: ScenarioDefinition = {
  meta: {
    id: 'crash-recovery',
    title: 'Crash recovery',
    summary: 'Inject worker crashes and compare recovery policies.',
  },
  Component: CrashRecoveryScenario,
}
