import {
  Box,
  Button,
  Collapsible,
  createListCollection,
  HStack,
  Input,
  Portal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
} from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'

import { createTaskRuntime } from '../../src'
import type { CrashPolicy, QueuePolicy } from '../../src/types'
import type { FlowGraph } from './harness/flow-types'
import RuntimeSnapshotPanel from './RuntimeSnapshotPanel'
import {
  createImagePipelineTasks,
  disposeImagePipelineTasks,
  generateImages,
  type PipelineTasks,
  runImagePipeline,
} from './workflows/image-pipeline'

type RunStatus = 'idle' | 'running' | 'done'
type TabId = 'overview' | 'throughput' | 'backpressure' | 'cancellation' | 'crashes' | 'playground'

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
  { label: 'Block (wait at call site)', value: 'block' },
  { label: 'Reject (fail immediately)', value: 'reject' },
  { label: 'Drop oldest (evict queue head)', value: 'drop-oldest' },
  { label: 'Drop latest (evict new item)', value: 'drop-latest' },
]

const crashPolicies: { label: string; value: CrashPolicy }[] = [
  { label: 'Restart + requeue work', value: 'restart-requeue-in-flight' },
  { label: 'Restart + fail in-flight', value: 'restart-fail-in-flight' },
  { label: 'Fail task entirely', value: 'fail-task' },
]

const Divider = () => <Box borderTopWidth="1px" borderColor="gray.200" />

const SectionHeader = ({
  title,
  isOpen,
  onToggle,
  onReset,
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
  onReset?: () => void
}) => (
  <HStack justify="space-between" p={3} cursor="pointer" onClick={onToggle} userSelect="none">
    <HStack gap={2}>
      {isOpen ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}
      <Text fontWeight="medium" fontSize="sm">
        {title}
      </Text>
    </HStack>
    {onReset && (
      <Button
        size="xs"
        variant="ghost"
        onClick={e => {
          e.stopPropagation()
          onReset()
        }}
      >
        Reset
      </Button>
    )}
  </HStack>
)

// Per-tab default configurations
type TabConfig = {
  imageCount: number
  limitConcurrency: boolean
  maxConcurrent: number
  limitQueueDepth: boolean
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  crashPolicy: CrashPolicy
}

const TAB_DEFAULTS: Record<TabId, TabConfig> = {
  overview: {
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  throughput: {
    // Focus on concurrency - backpressure off so queue behavior doesn't distract
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  backpressure: {
    // Focus on queue limits - high concurrency to pressure the queue
    imageCount: 40,
    limitConcurrency: false,
    maxConcurrent: 12,
    limitQueueDepth: true,
    maxQueueDepth: 8,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  cancellation: {
    // Focus on aborting - moderate settings so there's queued work to cancel
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 4,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  crashes: {
    // Focus on crash recovery
    imageCount: 24,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: false,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
  playground: {
    // All features with sensible defaults
    imageCount: 30,
    limitConcurrency: true,
    maxConcurrent: 6,
    limitQueueDepth: true,
    maxQueueDepth: 12,
    queuePolicy: 'block',
    crashPolicy: 'restart-requeue-in-flight',
  },
}

const Playground = () => {
  // UI state
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['throughput']))

  // Get defaults for current tab
  const getDefaults = useCallback((tab: TabId) => TAB_DEFAULTS[tab], [])

  // Run state
  const runtime = useMemo(() => createTaskRuntime({ observability: { spans: 'off' } }), [])
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [canceled, setCanceled] = useState(0)
  const runIdRef = useRef(0)
  const runKeyRef = useRef<string | null>(null)

  // Controls - initialize from overview defaults
  const initialDefaults = TAB_DEFAULTS.overview
  const [imageCount, setImageCount] = useState(initialDefaults.imageCount)
  const [limitConcurrency, setLimitConcurrency] = useState(initialDefaults.limitConcurrency)
  const [maxConcurrent, setMaxConcurrent] = useState(initialDefaults.maxConcurrent)

  // Backpressure
  const [limitQueueDepth, setLimitQueueDepth] = useState(initialDefaults.limitQueueDepth)
  const [maxQueueDepth, setMaxQueueDepth] = useState(initialDefaults.maxQueueDepth)
  const [queuePolicy, setQueuePolicy] = useState<QueuePolicy>(initialDefaults.queuePolicy)

  // Crash recovery
  const [crashPolicy, setCrashPolicy] = useState<CrashPolicy>(initialDefaults.crashPolicy)
  const [crashArmed, setCrashArmed] = useState(false)
  const crashRequestedRef = useRef(false)

  // Apply tab defaults
  const applyTabDefaults = useCallback(
    (tab: TabId) => {
      const defaults = getDefaults(tab)
      setImageCount(defaults.imageCount)
      setLimitConcurrency(defaults.limitConcurrency)
      setMaxConcurrent(defaults.maxConcurrent)
      setLimitQueueDepth(defaults.limitQueueDepth)
      setMaxQueueDepth(defaults.maxQueueDepth)
      setQueuePolicy(defaults.queuePolicy)
      setCrashPolicy(defaults.crashPolicy)
    },
    [getDefaults]
  )

  const queuePolicyCollection = useMemo(() => createListCollection({ items: queuePolicies }), [])
  const crashPolicyCollection = useMemo(() => createListCollection({ items: crashPolicies }), [])

  // Build tasks with current config
  const buildTasks = useCallback(() => {
    disposeImagePipelineTasks(tasksRef.current)
    tasksRef.current = createImagePipelineTasks(runtime, {
      analyze: {
        queuePolicy,
        maxQueueDepth: limitQueueDepth ? maxQueueDepth : undefined,
        crashPolicy,
        crashMaxRetries: 2,
      },
    })
  }, [runtime, queuePolicy, maxQueueDepth, limitQueueDepth, crashPolicy])

  // Initialize tasks on mount and when config changes
  useEffect(() => {
    buildTasks()
    return () => {
      disposeImagePipelineTasks(tasksRef.current)
    }
  }, [buildTasks])

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const handleRun = useCallback(async () => {
    if (runStatus === 'running') return
    const tasks = tasksRef.current
    if (!tasks) return

    const runId = ++runIdRef.current
    const effectiveConcurrency = limitConcurrency ? Math.max(1, maxConcurrent) : imageCount
    const runKey = `run-${runId}`
    runKeyRef.current = runKey

    runtime.abortTaskController.clear(runKey)
    const signal = runtime.abortTaskController.signalFor(runKey)

    setRunStatus('running')
    setCompleted(0)
    setFailed(0)
    setCanceled(0)
    setCrashArmed(crashRequestedRef.current)

    const images = generateImages(imageCount)

    try {
      for await (const result of runImagePipeline({
        tasks,
        images,
        concurrencyLimit: effectiveConcurrency,
        dispatchOptions: { key: runKey, signal },
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
          const isCanceled =
            result.error instanceof Error &&
            (result.error.name === 'AbortError' || result.error.name === 'TaskAbortedError')
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
  }, [runStatus, imageCount, limitConcurrency, maxConcurrent, runtime])

  const handleAbort = useCallback(() => {
    const runKey = runKeyRef.current
    if (!runKey) return
    runtime.abortTaskController.abort(runKey)
  }, [runtime])

  const handleReset = useCallback(() => {
    runIdRef.current++
    runKeyRef.current = null
    crashRequestedRef.current = false
    setCrashArmed(false)
    setRunStatus('idle')
    setCompleted(0)
    setFailed(0)
    setCanceled(0)
    buildTasks()
  }, [buildTasks])

  const handleCrashNext = useCallback(() => {
    crashRequestedRef.current = true
    setCrashArmed(true)
  }, [])

  const resetThroughput = useCallback(() => {
    const defaults = TAB_DEFAULTS[activeTab]
    setImageCount(defaults.imageCount)
    setLimitConcurrency(defaults.limitConcurrency)
    setMaxConcurrent(defaults.maxConcurrent)
  }, [activeTab])

  const resetBackpressure = useCallback(() => {
    const defaults = TAB_DEFAULTS[activeTab]
    setLimitQueueDepth(defaults.limitQueueDepth)
    setMaxQueueDepth(defaults.maxQueueDepth)
    setQueuePolicy(defaults.queuePolicy)
  }, [activeTab])

  const resetCrashes = useCallback(() => {
    const defaults = TAB_DEFAULTS[activeTab]
    setCrashPolicy(defaults.crashPolicy)
    crashRequestedRef.current = false
    setCrashArmed(false)
  }, [activeTab])

  const isRunning = runStatus === 'running'

  // Shared status bar
  const status = (
    <HStack gap={6} fontSize="sm" color="gray.600" flexWrap="wrap">
      <HStack gap={2}>
        <Text>Status</Text>
        <Text fontWeight="semibold" color="gray.800">
          {runStatus}
        </Text>
      </HStack>
      <HStack gap={2}>
        <Text>Completed</Text>
        <Text fontWeight="semibold" color="green.600">
          {completed}
        </Text>
      </HStack>
      {canceled > 0 && (
        <HStack gap={2}>
          <Text>Canceled</Text>
          <Text fontWeight="semibold" color="orange.600">
            {canceled}
          </Text>
        </HStack>
      )}
      {failed > 0 && (
        <HStack gap={2}>
          <Text>Failed</Text>
          <Text fontWeight="semibold" color="red.600">
            {failed}
          </Text>
        </HStack>
      )}
      <HStack gap={2}>
        <Text>Total</Text>
        <Text fontWeight="semibold" color="gray.800">
          {imageCount}
        </Text>
      </HStack>
    </HStack>
  )

  // Action buttons - shared across tabs
  const actionButtons = (
    <HStack gap={2}>
      <Button size="sm" colorScheme="blue" onClick={handleRun} disabled={isRunning}>
        {isRunning ? 'Running...' : 'Run'}
      </Button>
      {isRunning && (
        <Button size="sm" variant="outline" onClick={handleAbort}>
          Abort
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={handleReset}>
        Reset
      </Button>
    </HStack>
  )

  // Tab-specific controls
  const throughputControls = (
    <Stack gap={0}>
      <Box p={4}>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="medium" fontSize="sm">
            Throughput
          </Text>
          <Button size="xs" variant="ghost" onClick={resetThroughput}>
            Reset
          </Button>
        </HStack>
        <Stack gap={3}>
          <Text fontSize="xs" color="gray.500">
            Control how many images flow through the pipeline simultaneously.
          </Text>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Images to process
            </Text>
            <Input
              size="sm"
              type="number"
              value={imageCount}
              min={1}
              max={200}
              onChange={e => setImageCount(Number(e.target.value))}
            />
          </Box>
          <Box>
            <HStack justify="space-between">
              <Text fontSize="xs" color="gray.500">
                Limit parallel pipelines
              </Text>
              <Switch.Root
                size="sm"
                checked={limitConcurrency}
                onCheckedChange={e => setLimitConcurrency(e.checked)}
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </HStack>
          </Box>
          {limitConcurrency && (
            <Box>
              <Text fontSize="xs" color="gray.500" mb={1}>
                Max parallel
              </Text>
              <Input
                size="sm"
                type="number"
                value={maxConcurrent}
                min={1}
                max={64}
                onChange={e => setMaxConcurrent(Number(e.target.value))}
              />
            </Box>
          )}
        </Stack>
      </Box>
      <Divider />
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )

  const backpressureControls = (
    <Stack gap={0}>
      <Box p={4}>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="medium" fontSize="sm">
            Backpressure
          </Text>
          <Button size="xs" variant="ghost" onClick={resetBackpressure}>
            Reset
          </Button>
        </HStack>
        <Stack gap={3}>
          <Text fontSize="xs" color="gray.500">
            Control how the Analyze task handles work when its queue fills up.
          </Text>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Images to process
            </Text>
            <Input
              size="sm"
              type="number"
              value={imageCount}
              min={1}
              max={200}
              onChange={e => setImageCount(Number(e.target.value))}
            />
          </Box>
          <Box>
            <HStack justify="space-between">
              <Text fontSize="xs" color="gray.500">
                Limit queue depth
              </Text>
              <Switch.Root
                size="sm"
                checked={limitQueueDepth}
                onCheckedChange={e => setLimitQueueDepth(e.checked)}
              >
                <Switch.HiddenInput />
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>
            </HStack>
          </Box>
          {limitQueueDepth && (
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
                onChange={e => setMaxQueueDepth(Number(e.target.value))}
              />
            </Box>
          )}
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Queue policy
            </Text>
            <Select.Root
              size="sm"
              value={[queuePolicy]}
              onValueChange={e => {
                const next = e.value[0] as QueuePolicy | undefined
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
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )

  const cancellationControls = (
    <Stack gap={0}>
      <Box p={4}>
        <Text fontWeight="medium" fontSize="sm" mb={3}>
          Cancellation
        </Text>
        <Stack gap={3}>
          <Text fontSize="xs" color="gray.500">
            Start a run and use Abort to cancel all in-progress and queued work.
          </Text>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Images to process
            </Text>
            <Input
              size="sm"
              type="number"
              value={imageCount}
              min={1}
              max={200}
              onChange={e => setImageCount(Number(e.target.value))}
            />
          </Box>
          {runKeyRef.current && (
            <Text fontSize="xs" color="gray.400">
              Run key: {runKeyRef.current}
            </Text>
          )}
        </Stack>
      </Box>
      <Divider />
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )

  const crashControls = (
    <Stack gap={0}>
      <Box p={4}>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="medium" fontSize="sm">
            Crash Recovery
          </Text>
          <Button size="xs" variant="ghost" onClick={resetCrashes}>
            Reset
          </Button>
        </HStack>
        <Stack gap={3}>
          <Text fontSize="xs" color="gray.500">
            Test how the system recovers when a worker crashes.
          </Text>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Images to process
            </Text>
            <Input
              size="sm"
              type="number"
              value={imageCount}
              min={1}
              max={200}
              onChange={e => setImageCount(Number(e.target.value))}
            />
          </Box>
          <Box>
            <Text fontSize="xs" color="gray.500" mb={1}>
              Crash policy
            </Text>
            <Select.Root
              size="sm"
              value={[crashPolicy]}
              onValueChange={e => {
                const next = e.value[0] as CrashPolicy | undefined
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
          <Button
            size="sm"
            variant="outline"
            colorScheme={crashArmed ? 'orange' : 'gray'}
            onClick={handleCrashNext}
          >
            {crashArmed ? 'Crash armed!' : 'Crash next'}
          </Button>
          {crashArmed && (
            <Text fontSize="xs" color="orange.600">
              Next Analyze call will crash the worker.
            </Text>
          )}
        </Stack>
      </Box>
      <Divider />
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )

  // Playground controls - all settings with collapsible sections
  const playgroundControls = (
    <Stack gap={0}>
      {/* Throughput section */}
      <Collapsible.Root open={expandedSections.has('throughput')}>
        <SectionHeader
          title="Throughput"
          isOpen={expandedSections.has('throughput')}
          onToggle={() => toggleSection('throughput')}
          onReset={resetThroughput}
        />
        <Collapsible.Content>
          <Box px={4} pb={4}>
            <Stack gap={3}>
              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  Images to process
                </Text>
                <Input
                  size="sm"
                  type="number"
                  value={imageCount}
                  min={1}
                  max={200}
                  onChange={e => setImageCount(Number(e.target.value))}
                />
              </Box>
              <Box>
                <HStack justify="space-between">
                  <Text fontSize="xs" color="gray.500">
                    Limit parallel pipelines
                  </Text>
                  <Switch.Root
                    size="sm"
                    checked={limitConcurrency}
                    onCheckedChange={e => setLimitConcurrency(e.checked)}
                  >
                    <Switch.HiddenInput />
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>
                </HStack>
              </Box>
              {limitConcurrency && (
                <Box>
                  <Text fontSize="xs" color="gray.500" mb={1}>
                    Max parallel
                  </Text>
                  <Input
                    size="sm"
                    type="number"
                    value={maxConcurrent}
                    min={1}
                    max={64}
                    onChange={e => setMaxConcurrent(Number(e.target.value))}
                  />
                </Box>
              )}
            </Stack>
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>

      <Divider />

      {/* Backpressure section */}
      <Collapsible.Root open={expandedSections.has('backpressure')}>
        <SectionHeader
          title="Backpressure"
          isOpen={expandedSections.has('backpressure')}
          onToggle={() => toggleSection('backpressure')}
          onReset={resetBackpressure}
        />
        <Collapsible.Content>
          <Box px={4} pb={4}>
            <Stack gap={3}>
              <Box>
                <HStack justify="space-between">
                  <Text fontSize="xs" color="gray.500">
                    Limit queue depth
                  </Text>
                  <Switch.Root
                    size="sm"
                    checked={limitQueueDepth}
                    onCheckedChange={e => setLimitQueueDepth(e.checked)}
                  >
                    <Switch.HiddenInput />
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>
                </HStack>
              </Box>
              {limitQueueDepth && (
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
                    onChange={e => setMaxQueueDepth(Number(e.target.value))}
                  />
                </Box>
              )}
              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  Queue policy
                </Text>
                <Select.Root
                  size="sm"
                  value={[queuePolicy]}
                  onValueChange={e => {
                    const next = e.value[0] as QueuePolicy | undefined
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
        </Collapsible.Content>
      </Collapsible.Root>

      <Divider />

      {/* Cancellation section */}
      <Collapsible.Root open={expandedSections.has('cancellation')}>
        <SectionHeader
          title="Cancellation"
          isOpen={expandedSections.has('cancellation')}
          onToggle={() => toggleSection('cancellation')}
        />
        <Collapsible.Content>
          <Box px={4} pb={4}>
            <Stack gap={3}>
              <Text fontSize="xs" color="gray.500">
                Use Abort to cancel all in-progress and queued work.
              </Text>
              {runKeyRef.current && (
                <Text fontSize="xs" color="gray.400">
                  Run key: {runKeyRef.current}
                </Text>
              )}
            </Stack>
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>

      <Divider />

      {/* Crash Recovery section */}
      <Collapsible.Root open={expandedSections.has('crashes')}>
        <SectionHeader
          title="Crash Recovery"
          isOpen={expandedSections.has('crashes')}
          onToggle={() => toggleSection('crashes')}
          onReset={resetCrashes}
        />
        <Collapsible.Content>
          <Box px={4} pb={4}>
            <Stack gap={3}>
              <Box>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  Crash policy
                </Text>
                <Select.Root
                  size="sm"
                  value={[crashPolicy]}
                  onValueChange={e => {
                    const next = e.value[0] as CrashPolicy | undefined
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
              <Button
                size="sm"
                variant="outline"
                colorScheme={crashArmed ? 'orange' : 'gray'}
                onClick={handleCrashNext}
              >
                {crashArmed ? 'Crash armed!' : 'Crash next'}
              </Button>
              {crashArmed && (
                <Text fontSize="xs" color="orange.600">
                  Next Analyze call will crash the worker.
                </Text>
              )}
            </Stack>
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>

      <Divider />

      {/* Actions */}
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )

  const getControlsForTab = () => {
    switch (activeTab) {
      case 'throughput':
        return throughputControls
      case 'backpressure':
        return backpressureControls
      case 'cancellation':
        return cancellationControls
      case 'crashes':
        return crashControls
      case 'playground':
        return playgroundControls
      default:
        return null
    }
  }

  const handleTabChange = useCallback(
    (newTab: TabId) => {
      if (newTab !== activeTab) {
        // Reset workflow when switching tabs
        runIdRef.current++
        runKeyRef.current = null
        crashRequestedRef.current = false
        setCrashArmed(false)
        setRunStatus('idle')
        setCompleted(0)
        setFailed(0)
        setCanceled(0)
        // Apply tab-specific defaults before switching
        applyTabDefaults(newTab)
        setActiveTab(newTab)
      }
    },
    [activeTab, applyTabDefaults]
  )

  const tabs = (
    <Tabs.Root value={activeTab} onValueChange={e => handleTabChange(e.value as TabId)} size="sm">
      <Tabs.List>
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        <Tabs.Trigger value="throughput">Throughput</Tabs.Trigger>
        <Tabs.Trigger value="backpressure">Backpressure</Tabs.Trigger>
        <Tabs.Trigger value="cancellation">Cancellation</Tabs.Trigger>
        <Tabs.Trigger value="crashes">Crashes</Tabs.Trigger>
        <Tabs.Trigger value="playground">Playground</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  )

  return (
    <Box minH="100vh" bg="gray.50" px={{ base: 4, lg: 6 }} py={5}>
      <Box maxW="1600px" mx="auto">
        <Stack gap={5}>
          {tabs}

          {activeTab === 'overview' ? (
            <OverviewContent />
          ) : (
            <SimpleGrid columns={{ base: 1, lg: 12 }} gap={5} alignItems="start">
              <Box
                gridColumn={{ base: 'span 1', lg: 'span 3' }}
                bg="white"
                borderWidth="1px"
                borderColor="gray.200"
                rounded="lg"
                overflow="hidden"
              >
                {getControlsForTab()}
              </Box>
              <Stack gridColumn={{ base: 'span 1', lg: 'span 9' }} gap={3}>
                <RuntimeSnapshotPanel runtime={runtime} onlyOnChange graph={graph} />
                {status}
              </Stack>
            </SimpleGrid>
          )}
        </Stack>
      </Box>
    </Box>
  )
}

const OverviewContent = () => (
  <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="lg" p={6}>
    <Stack gap={6}>
      <Stack gap={2}>
        <Text fontSize="xl" fontWeight="semibold">
          Image Processing Pipeline
        </Text>
        <Text color="gray.600">
          This demo shows a pipeline that processes images through three stages. Each stage runs in
          Web Workers, orchestrated by Atelier.
        </Text>
      </Stack>

      <Stack gap={4}>
        <Text fontWeight="medium">Pipeline Stages</Text>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <Box p={4} bg="blue.50" rounded="md">
            <Stack gap={2}>
              <Text fontWeight="medium" color="blue.800">
                Resize
              </Text>
              <Text fontSize="sm" color="blue.700">
                Parallel (4 workers)
              </Text>
              <Text fontSize="xs" color="gray.600">
                Resizing is CPU-bound but parallelizable. Multiple workers process images
                simultaneously for maximum throughput.
              </Text>
            </Stack>
          </Box>
          <Box p={4} bg="purple.50" rounded="md">
            <Stack gap={2}>
              <Text fontWeight="medium" color="purple.800">
                Analyze
              </Text>
              <Text fontSize="sm" color="purple.700">
                Singleton (1 worker)
              </Text>
              <Text fontSize="xs" color="gray.600">
                Analysis uses an ML model that's expensive to load. A singleton worker keeps the
                model warm between calls.
              </Text>
            </Stack>
          </Box>
          <Box p={4} bg="green.50" rounded="md">
            <Stack gap={2}>
              <Text fontWeight="medium" color="green.800">
                Enhance
              </Text>
              <Text fontSize="sm" color="green.700">
                Singleton (idle timeout)
              </Text>
              <Text fontSize="xs" color="gray.600">
                Enhancement is optional and bursty. The worker spins down after 10s of inactivity to
                free resources.
              </Text>
            </Stack>
          </Box>
        </SimpleGrid>
      </Stack>

      <Stack gap={4}>
        <Text fontWeight="medium">What to Explore</Text>
        <Stack gap={2} fontSize="sm" color="gray.600">
          <Text>
            <strong>Throughput:</strong> See how limiting parallel pipelines prevents the singleton
            bottleneck from being overwhelmed.
          </Text>
          <Text>
            <strong>Backpressure:</strong> Configure queue depth and policies to handle overload
            gracefully.
          </Text>
          <Text>
            <strong>Cancellation:</strong> Abort a running batch and observe how queued vs in-flight
            work is handled.
          </Text>
          <Text>
            <strong>Crashes:</strong> Inject a worker crash and see how different policies recover.
          </Text>
          <Text>
            <strong>Playground:</strong> Combine all settings and experiment freely.
          </Text>
        </Stack>
      </Stack>

      <Text fontSize="sm" color="gray.500">
        Select a tab above to start experimenting.
      </Text>
    </Stack>
  </Box>
)

export default Playground
