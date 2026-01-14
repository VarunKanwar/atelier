import {
  Badge,
  Box,
  Button,
  Collapsible,
  Container,
  createListCollection,
  Heading,
  HStack,
  Input,
  Portal,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
} from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createTaskRuntime, parallelLimit, type TaskRuntime, type TraceContext } from '../../src'
import RuntimeObservabilityPanel from './RuntimeObservabilityPanel'
import { useRuntimeEvents } from './useRuntimeEvents'
import type { AnalyzeAPI } from './workers/analyze.worker'
import type { EnhanceAPI } from './workers/enhance.worker'
import type { ImageData, ResizeAPI } from './workers/resize.worker'

type RunStatus = 'idle' | 'running' | 'done'

type ResultItem = {
  id: string
  status: 'fulfilled' | 'rejected'
  message: string
}

const createTasks = (runtime: TaskRuntime) => {
  const resize = runtime.defineTask<ResizeAPI>({
    type: 'parallel',
    worker: () =>
      new Worker(new URL('./workers/resize.worker.ts', import.meta.url), { type: 'module' }),
    poolSize: 4,
    init: 'lazy',
    taskName: 'resize',
  })
  const analyze = runtime.defineTask<AnalyzeAPI>({
    type: 'singleton',
    worker: () =>
      new Worker(new URL('./workers/analyze.worker.ts', import.meta.url), { type: 'module' }),
    init: 'eager',
    taskName: 'analyze',
  })
  const enhance = runtime.defineTask<EnhanceAPI>({
    type: 'singleton',
    worker: () =>
      new Worker(new URL('./workers/enhance.worker.ts', import.meta.url), { type: 'module' }),
    init: 'lazy',
    taskName: 'enhance',
    idleTimeoutMs: 10 * 1000, // Auto-terminate after 10s idle
  })

  return { resize, analyze, enhance }
}

const generateImages = (count: number): ImageData[] => {
  return Array.from({ length: count }, (_, i) => ({
    name: `image-${String(i + 1).padStart(3, '0')}.jpg`,
    width: 1920 + Math.floor(Math.random() * 1080),
    height: 1080 + Math.floor(Math.random() * 920),
    size: 1_000_000 + Math.floor(Math.random() * 5_000_000),
  }))
}

const clampNumber = (value: number, fallback: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

const RuntimeObservabilityPage = () => {
  const runtime = useMemo(
    () =>
      createTaskRuntime({
        observability: { spans: { mode: 'on', sampleRate: 1 } },
      }),
    []
  )
  const tasksRef = useRef<ReturnType<typeof createTasks> | null>(null)
  if (!tasksRef.current) {
    tasksRef.current = createTasks(runtime)
  }

  const [batchSize, setBatchSize] = useState(20)
  const [concurrencyLimit, setConcurrencyLimit] = useState(6)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [inFlight, setInFlight] = useState(0)
  const [maxInFlight, setMaxInFlight] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [traceMode, setTraceMode] = useState<'run' | 'image'>('run')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const [results, setResults] = useState<ResultItem[]>([])
  const runIdRef = useRef(0)
  const { stats: eventStats, reset: resetEvents } = useRuntimeEvents(runtime)
  const [detailsExpanded, setDetailsExpanded] = useState(true)
  const traceScopeOptions = useMemo(
    () =>
      createListCollection({
        items: [
          { label: 'Per run', value: 'run' },
          { label: 'Per image', value: 'image' },
        ],
      }),
    []
  )
  const traceVisualization = useMemo(() => {
    const traceId = eventStats.lastTraceId
    if (!traceId) return null
    const trace = eventStats.traces.find(item => item.traceId === traceId) ?? eventStats.traces[0]
    if (!trace) return null
    const spans = eventStats.spansByTraceId[trace.traceId] ?? []
    if (spans.length === 0) {
      return { trace, spans: [] as { span: (typeof spans)[number] }[] }
    }

    const entries = spans.map(span => {
      const duration = span.durationMs ?? 0
      const end = span.ts
      const start = end - duration
      return { span, start, end, duration }
    })

    const minStart = Math.min(...entries.map(entry => entry.start))
    const maxEnd = Math.max(...entries.map(entry => entry.end))
    const traceStart = trace.durationMs ? trace.ts - trace.durationMs : minStart
    const traceEnd = trace.durationMs ? trace.ts : maxEnd
    const traceDuration = Math.max(1, traceEnd - traceStart)

    const normalized = entries
      .sort((a, b) => a.start - b.start)
      .map(entry => {
        const wait = Math.min(entry.span.queueWaitMs ?? 0, entry.duration)
        const exec = Math.max(0, entry.duration - wait)
        const offsetPct = ((entry.start - traceStart) / traceDuration) * 100
        const widthPct = (entry.duration / traceDuration) * 100
        const waitPct = entry.duration > 0 ? (wait / entry.duration) * 100 : 0
        return {
          span: entry.span,
          offsetPct,
          widthPct,
          waitPct,
          exec,
        }
      })

    return { trace, spans: normalized, traceDuration }
  }, [eventStats])
  const resultsContent = (
    <Stack gap={3}>
      <HStack justify="space-between">
        <Text fontWeight="semibold">Recent results</Text>
        <Badge bg="gray.100" color="gray.700">
          {results.length} shown
        </Badge>
      </HStack>
      {results.length === 0 ? (
        <Text fontSize="sm" color="gray.500">
          Run the demo to see recent completions and errors.
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
  )
  const eventContent = (
    <Stack gap={4}>
      <HStack justify="space-between">
        <Text fontWeight="semibold">Event stream</Text>
        <Badge bg="gray.100" color="gray.700">
          Updated {new Date(eventStats.updatedAt).toLocaleTimeString()}
        </Badge>
      </HStack>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
        <Stack gap={2}>
          <Text fontSize="sm" fontWeight="semibold">
            Counters
          </Text>
          {[
            { name: 'task.dispatch.total', label: 'Dispatched' },
            { name: 'task.success.total', label: 'Succeeded' },
            { name: 'task.failure.total', label: 'Failed' },
            { name: 'task.canceled.total', label: 'Canceled' },
            { name: 'task.rejected.total', label: 'Rejected' },
            { name: 'task.requeue.total', label: 'Requeued' },
            { name: 'worker.crash.total', label: 'Worker crashes' },
          ].map(item => (
            <HStack key={item.name} justify="space-between">
              <Text fontSize="xs" color="gray.500">
                {item.label}
              </Text>
              <Text fontSize="sm" fontWeight="semibold">
                {eventStats.counters[item.name] ?? 0}
              </Text>
            </HStack>
          ))}
        </Stack>

        <Stack gap={2}>
          <Text fontSize="sm" fontWeight="semibold">
            Latest histograms
          </Text>
          <HStack justify="space-between">
            <Text fontSize="xs" color="gray.500">
              queue.wait_ms
            </Text>
            <Text fontSize="sm" fontWeight="semibold">
              {eventStats.lastQueueWaitMs !== undefined
                ? `${eventStats.lastQueueWaitMs.toFixed(0)} ms`
                : '—'}
            </Text>
          </HStack>
          <HStack justify="space-between">
            <Text fontSize="xs" color="gray.500">
              task.duration_ms
            </Text>
            <Text fontSize="sm" fontWeight="semibold">
              {eventStats.lastTaskDurationMs !== undefined
                ? `${eventStats.lastTaskDurationMs.toFixed(0)} ms`
                : '—'}
            </Text>
          </HStack>
        </Stack>
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
        <Stack gap={2}>
          <Text fontSize="sm" fontWeight="semibold">
            Recent spans
          </Text>
          {eventStats.spans.length === 0 ? (
            <Text fontSize="sm" color="gray.500">
              No spans yet.
            </Text>
          ) : (
            eventStats.spans.map(span => (
              <HStack key={span.spanId} justify="space-between">
                <Box>
                  <Text fontSize="sm" color="gray.700">
                    {`${span.taskName ?? span.taskId}.${span.method}`}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    {span.status}
                    {span.durationMs ? ` · ${span.durationMs.toFixed(0)} ms` : ''}
                    {span.queueWaitMs ? ` · wait ${span.queueWaitMs.toFixed(0)} ms` : ''}
                  </Text>
                </Box>
                <Badge
                  bg={
                    span.status === 'ok'
                      ? 'green.50'
                      : span.status === 'canceled'
                        ? 'orange.50'
                        : 'red.50'
                  }
                  color={
                    span.status === 'ok'
                      ? 'green.700'
                      : span.status === 'canceled'
                        ? 'orange.700'
                        : 'red.700'
                  }
                >
                  {span.status}
                </Badge>
              </HStack>
            ))
          )}
        </Stack>

        <Stack gap={2}>
          <Text fontSize="sm" fontWeight="semibold">
            Recent traces
          </Text>
          {eventStats.traces.length === 0 ? (
            <Text fontSize="sm" color="gray.500">
              No traces yet.
            </Text>
          ) : (
            eventStats.traces.map(trace => (
              <HStack key={trace.traceId} justify="space-between">
                <Box>
                  <Text fontSize="sm" color="gray.700">
                    {trace.traceName ?? trace.traceId}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    {trace.status}
                    {trace.durationMs ? ` · ${trace.durationMs.toFixed(0)} ms` : ''}
                  </Text>
                </Box>
                <Badge
                  bg={
                    trace.status === 'ok'
                      ? 'green.50'
                      : trace.status === 'canceled'
                        ? 'orange.50'
                        : 'red.50'
                  }
                  color={
                    trace.status === 'ok'
                      ? 'green.700'
                      : trace.status === 'canceled'
                        ? 'orange.700'
                        : 'red.700'
                  }
                >
                  {trace.status}
                </Badge>
              </HStack>
            ))
          )}
        </Stack>
      </SimpleGrid>

      <Stack gap={3}>
        <HStack justify="space-between">
          <Text fontSize="sm" fontWeight="semibold">
            Trace timeline
          </Text>
          {traceVisualization?.trace ? (
            <Badge bg="gray.100" color="gray.700">
              {traceVisualization.trace.traceName ?? traceVisualization.trace.traceId}
            </Badge>
          ) : null}
        </HStack>

        {!traceVisualization ? (
          <Text fontSize="sm" color="gray.500">
            No trace data yet.
          </Text>
        ) : traceVisualization.spans.length === 0 ? (
          <Text fontSize="sm" color="gray.500">
            Trace captured, no spans recorded.
          </Text>
        ) : (
          <Stack gap={3}>
            {traceVisualization.spans.map(entry => {
              const span = entry.span
              const status =
                span.status === 'ok'
                  ? { bg: 'green.400', text: 'green.700' }
                  : span.status === 'canceled'
                    ? { bg: 'orange.400', text: 'orange.700' }
                    : { bg: 'red.400', text: 'red.700' }
              return (
                <Stack key={span.spanId} gap={1}>
                  <HStack justify="space-between" fontSize="xs">
                    <Text color="gray.600">{`${span.taskName ?? span.taskId}.${span.method}`}</Text>
                    <Text color="gray.500">{(span.durationMs ?? 0).toFixed(0)} ms</Text>
                  </HStack>
                  <Box position="relative" h="10px" bg="gray.100" rounded="full">
                    <Box
                      position="absolute"
                      left={`${entry.offsetPct}%`}
                      width={`${entry.widthPct}%`}
                      h="100%"
                      bg={status.bg}
                      rounded="full"
                      overflow="hidden"
                    >
                      <Box h="100%" w={`${entry.waitPct}%`} bg="gray.400" opacity={0.5} />
                    </Box>
                  </Box>
                </Stack>
              )
            })}
            <Text fontSize="xs" color="gray.500">
              Gray segment indicates queue wait time within each span.
            </Text>
          </Stack>
        )}
      </Stack>
    </Stack>
  )
  useEffect(() => {
    return () => {
      const tasks = tasksRef.current
      if (!tasks) return
      tasks.resize.dispose()
      tasks.analyze.dispose()
      tasks.enhance.dispose()
    }
  }, [])

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

  const processImage = useCallback(async (image: ImageData, trace?: TraceContext) => {
    const tasks = tasksRef.current
    if (!tasks) {
      throw new Error('Task runtime not initialized')
    }
    const resized = trace
      ? await tasks.resize.with({ trace }).process(image)
      : await tasks.resize.process(image)
    const analyzed = trace
      ? await tasks.analyze.with({ trace }).process(resized)
      : await tasks.analyze.process(resized)
    return trace
      ? await tasks.enhance.with({ trace }).process(analyzed)
      : await tasks.enhance.process(analyzed)
  }, [])

  const handleRun = useCallback(async () => {
    if (status === 'running') return
    const runId = ++runIdRef.current
    const resolvedBatch = clampNumber(batchSize, 20, 1, 200)
    const resolvedLimit = clampNumber(concurrencyLimit, 6, 1, 64)

    if (isPaused) {
      const tasks = tasksRef.current
      tasks?.resize.startWorkers()
      tasks?.analyze.startWorkers()
      tasks?.enhance.startWorkers()
      setIsPaused(false)
    }

    setStatus('running')
    setCompleted(0)
    setFailed(0)
    setInFlight(0)
    setMaxInFlight(0)
    setResults([])
    setStartedAt(Date.now())
    setFinishedAt(null)
    resetEvents()

    const images = generateImages(resolvedBatch)
    let active = 0
    let maxActive = 0

    try {
      const runBatch = async (trace?: TraceContext) => {
        const processWithTracking = async (image: ImageData) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          setInFlight(active)
          setMaxInFlight(maxActive)
          try {
            if (traceMode === 'image') {
              return await runtime.runWithTrace(`image:${image.name}`, async imageTrace =>
                processImage(image, imageTrace)
              )
            }
            return await processImage(image, trace)
          } finally {
            active = Math.max(0, active - 1)
            setInFlight(active)
          }
        }

        for await (const result of parallelLimit(images, resolvedLimit, processWithTracking, {
          returnSettled: true,
        })) {
          if (runIdRef.current !== runId) break
          if (result.status === 'fulfilled') {
            setCompleted(prev => prev + 1)
            setResults(prev =>
              [
                {
                  id: result.value.name,
                  status: 'fulfilled' as const,
                  message: `${result.value.name}: ${result.value.objects.join(', ')}`,
                },
                ...prev,
              ].slice(0, 6)
            )
          } else {
            setFailed(prev => prev + 1)
            const message =
              result.error instanceof Error ? result.error.message : String(result.error)
            setResults(prev =>
              [
                {
                  id: result.item.name,
                  status: 'rejected' as const,
                  message: `${result.item.name}: ${message}`,
                },
                ...prev,
              ].slice(0, 6)
            )
          }
        }
      }

      if (traceMode === 'run') {
        await runtime.runWithTrace(`demo-run-${runId}`, async trace => runBatch(trace))
      } else {
        await runBatch()
      }
    } finally {
      if (runIdRef.current === runId) {
        setStatus('done')
        setFinishedAt(Date.now())
      }
    }
  }, [batchSize, concurrencyLimit, isPaused, processImage, resetEvents, runtime, status, traceMode])

  const handlePauseToggle = useCallback(() => {
    const tasks = tasksRef.current
    if (!tasks) return
    if (isPaused) {
      tasks.resize.startWorkers()
      tasks.analyze.startWorkers()
      tasks.enhance.startWorkers()
      setIsPaused(false)
    } else {
      tasks.resize.stopWorkers()
      tasks.analyze.stopWorkers()
      tasks.enhance.stopWorkers()
      setIsPaused(true)
    }
  }, [isPaused])

  const handleTerminate = useCallback(() => {
    runIdRef.current += 1
    const tasks = tasksRef.current
    if (tasks) {
      tasks.resize.dispose()
      tasks.analyze.dispose()
      tasks.enhance.dispose()
    }
    tasksRef.current = createTasks(runtime)
    setStatus('idle')
    setInFlight(0)
    setMaxInFlight(0)
    setIsPaused(false)
  }, [runtime])

  return (
    <Box minH="100vh" bg="gray.50">
      <Container py={10} maxW="6xl">
        <Stack gap={6}>
          <Stack gap={2}>
            <Heading size="lg">Atelier Observability</Heading>
            <Text color="gray.600">
              Live view of worker pools, queues, and bottlenecks while the demo pipeline runs.
            </Text>
          </Stack>

          <SimpleGrid columns={{ base: 1, lg: 3 }} gap={6}>
            <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
              <Stack gap={4}>
                <Stack gap={2}>
                  <Text fontWeight="semibold">Run controls</Text>
                  <Text fontSize="sm" color="gray.600">
                    Tune workload size and concurrency to surface queue pressure.
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
                      Concurrency limit
                    </Text>
                    <Input
                      type="number"
                      value={concurrencyLimit}
                      min={1}
                      max={64}
                      onChange={event => setConcurrencyLimit(Number(event.target.value))}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="xs" color="gray.500" mb={1}>
                      Trace scope
                    </Text>
                    <Select.Root
                      size="sm"
                      width="full"
                      collection={traceScopeOptions}
                      value={[traceMode]}
                      onValueChange={event => {
                        const next = event.value[0] as 'run' | 'image' | undefined
                        if (next) setTraceMode(next)
                      }}
                    >
                      <Select.HiddenSelect />
                      <Select.Control>
                        <Select.Trigger>
                          <Select.ValueText placeholder="Select trace scope" />
                        </Select.Trigger>
                        <Select.IndicatorGroup>
                          <Select.Indicator />
                        </Select.IndicatorGroup>
                      </Select.Control>
                      <Portal>
                        <Select.Positioner>
                          <Select.Content>
                            {traceScopeOptions.items.map(item => (
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

                <HStack gap={2}>
                  <Button onClick={handleRun} disabled={status === 'running'} colorScheme="blue">
                    {status === 'running' ? 'Running…' : 'Run demo'}
                  </Button>
                  <Button variant="outline" onClick={handlePauseToggle}>
                    {isPaused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button variant="outline" onClick={handleTerminate}>
                    Restart tasks
                  </Button>
                </HStack>

                <Stack gap={2}>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Status
                    </Text>
                    <Badge bg="gray.100" color="gray.700">
                      {status}
                    </Badge>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      In flight
                    </Text>
                    <Text fontWeight="semibold">
                      {inFlight} (max {maxInFlight})
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Completed / failed
                    </Text>
                    <Text fontWeight="semibold">
                      {completed} / {failed}
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Duration
                    </Text>
                    <Text fontWeight="semibold">{(durationMs / 1000).toFixed(1)}s</Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Throughput
                    </Text>
                    <Text fontWeight="semibold">
                      {throughput ? `${throughput.toFixed(2)} img/s` : '—'}
                    </Text>
                  </HStack>
                </Stack>
              </Stack>
            </Box>

            <Box gridColumn={{ base: 'span 1', lg: 'span 2' }}>
              <RuntimeObservabilityPanel runtime={runtime} intervalMs={250} onlyOnChange />
            </Box>
          </SimpleGrid>
          <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
            <Collapsible.Root
              open={detailsExpanded}
              onOpenChange={event => setDetailsExpanded(event.open)}
            >
              <Tabs.Root defaultValue="results">
                <HStack justify="space-between" mb={3} gap={3} align="center">
                  <Tabs.List display="flex" gap={2}>
                    <Tabs.Trigger value="results">Recent results</Tabs.Trigger>
                    <Tabs.Trigger value="events">Event stream</Tabs.Trigger>
                  </Tabs.List>
                  <Collapsible.Trigger asChild>
                    <Text fontSize="xs" color="gray.500" cursor="pointer">
                      {detailsExpanded ? 'Collapse' : 'Expand'}
                    </Text>
                  </Collapsible.Trigger>
                </HStack>

                <Tabs.Content value="results">
                  <Collapsible.Content>
                    <Box pr={2}>{resultsContent}</Box>
                  </Collapsible.Content>
                </Tabs.Content>

                <Tabs.Content value="events">
                  <Collapsible.Content>
                    <Box pr={2}>{eventContent}</Box>
                  </Collapsible.Content>
                </Tabs.Content>
              </Tabs.Root>
            </Collapsible.Root>
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default RuntimeObservabilityPage
