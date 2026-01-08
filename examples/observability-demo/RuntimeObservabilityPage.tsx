import {
  Badge,
  Box,
  Button,
  Container,
  HStack,
  Heading,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createTaskRuntime, parallelLimit, type TaskRuntime } from '../../core'
import type { AnalyzeAPI } from './workers/analyze.worker'
import type { EnhanceAPI } from './workers/enhance.worker'
import type { ImageData } from './workers/resize.worker'
import type { ResizeAPI } from './workers/resize.worker'
import RuntimeObservabilityPanel from './RuntimeObservabilityPanel'

type RunStatus = 'idle' | 'running' | 'done'

type ResultItem = {
  id: string
  status: 'fulfilled' | 'rejected'
  message: string
}

const createTasks = (runtime: TaskRuntime) => {
  const resize = runtime.defineTask<ResizeAPI>({
    type: 'parallel',
    worker: () => new Worker(new URL('./workers/resize.worker.ts', import.meta.url), { type: 'module' }),
    poolSize: 4,
    init: 'lazy',
    taskName: 'resize',
  })
  const analyze = runtime.defineTask<AnalyzeAPI>({
    type: 'singleton',
    worker: () => new Worker(new URL('./workers/analyze.worker.ts', import.meta.url), { type: 'module' }),
    init: 'eager',
    taskName: 'analyze',
  })
  const enhance = runtime.defineTask<EnhanceAPI>({
    type: 'singleton',
    worker: () => new Worker(new URL('./workers/enhance.worker.ts', import.meta.url), { type: 'module' }),
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
  const runtime = useMemo(() => createTaskRuntime(), [])
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
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const [results, setResults] = useState<ResultItem[]>([])
  const runIdRef = useRef(0)

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

  const processImage = useCallback(
    async (image: ImageData) => {
      const tasks = tasksRef.current
      if (!tasks) {
        throw new Error('Task runtime not initialized')
      }
      const resized = await tasks.resize.process(image)
      const analyzed = await tasks.analyze.process(resized)
      return tasks.enhance.process(analyzed)
    },
    [],
  )

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

    const images = generateImages(resolvedBatch)
    let active = 0
    let maxActive = 0

    const processWithTracking = async (image: ImageData) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      setInFlight(active)
      setMaxInFlight(maxActive)
      try {
        return await processImage(image)
      } finally {
        active = Math.max(0, active - 1)
        setInFlight(active)
      }
    }

    try {
      for await (const result of parallelLimit(images, resolvedLimit, processWithTracking, {
        returnSettled: true,
      })) {
        if (runIdRef.current !== runId) break
        if (result.status === 'fulfilled') {
          setCompleted((prev) => prev + 1)
          setResults((prev) =>
            [
              {
                id: result.value.name,
                status: 'fulfilled' as const,
                message: `${result.value.name}: ${result.value.objects.join(', ')}`,
              },
              ...prev,
            ].slice(0, 6),
          )
        } else {
          setFailed((prev) => prev + 1)
          const message =
            result.error instanceof Error ? result.error.message : String(result.error)
          setResults((prev) =>
            [
              {
                id: result.item.name,
                status: 'rejected' as const,
                message: `${result.item.name}: ${message}`,
              },
              ...prev,
            ].slice(0, 6),
          )
        }
      }
    } finally {
      if (runIdRef.current === runId) {
        setStatus('done')
        setFinishedAt(Date.now())
      }
    }
  }, [batchSize, concurrencyLimit, isPaused, processImage, status])

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
                      onChange={(event) => setBatchSize(Number(event.target.value))}
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
                      onChange={(event) => setConcurrencyLimit(Number(event.target.value))}
                    />
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
                    <Text fontWeight="semibold">
                      {(durationMs / 1000).toFixed(1)}s
                    </Text>
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
            <HStack justify="space-between" mb={3}>
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
                {results.map((result) => (
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
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default RuntimeObservabilityPage
