import { Box, HStack, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import type { CrashPolicy, QueuePolicy } from '@varunkanwar/atelier'
import { createTaskRuntime } from '@varunkanwar/atelier'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { graph, type RunStatus, TAB_DEFAULTS, type TabId } from './playground/constants'
import OverviewContent from './playground/OverviewContent'
import PlaygroundControls from './playground/PlaygroundControls'
import PlaygroundTabs from './playground/PlaygroundTabs'
import RuntimeSnapshotPanel from './RuntimeSnapshotPanel'
import {
  createImagePipelineTasks,
  disposeImagePipelineTasks,
  generateImages,
  type PipelineTasks,
  runImagePipeline,
} from './workflows/image-pipeline'

const Playground = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['throughput']))

  const runtime = useMemo(() => createTaskRuntime({ observability: { spans: 'off' } }), [])
  const tasksRef = useRef<PipelineTasks | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [completed, setCompleted] = useState(0)
  const [failed, setFailed] = useState(0)
  const [canceled, setCanceled] = useState(0)
  const runIdRef = useRef(0)
  const runKeyRef = useRef<string | null>(null)

  const initialDefaults = TAB_DEFAULTS.overview
  const [imageCount, setImageCount] = useState(initialDefaults.imageCount)
  const [limitConcurrency, setLimitConcurrency] = useState(initialDefaults.limitConcurrency)
  const [maxConcurrent, setMaxConcurrent] = useState(initialDefaults.maxConcurrent)

  const [limitQueueDepth, setLimitQueueDepth] = useState(initialDefaults.limitQueueDepth)
  const [maxQueueDepth, setMaxQueueDepth] = useState(initialDefaults.maxQueueDepth)
  const [queuePolicy, setQueuePolicy] = useState<QueuePolicy>(initialDefaults.queuePolicy)

  const [crashPolicy, setCrashPolicy] = useState<CrashPolicy>(initialDefaults.crashPolicy)
  const [crashArmed, setCrashArmed] = useState(false)
  const crashRequestedRef = useRef(false)

  const getDefaults = useCallback((tab: TabId) => TAB_DEFAULTS[tab], [])

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

  const handleTabChange = useCallback(
    (newTab: TabId) => {
      if (newTab !== activeTab) {
        runIdRef.current++
        runKeyRef.current = null
        crashRequestedRef.current = false
        setCrashArmed(false)
        setRunStatus('idle')
        setCompleted(0)
        setFailed(0)
        setCanceled(0)
        applyTabDefaults(newTab)
        setActiveTab(newTab)
      }
    },
    [activeTab, applyTabDefaults]
  )

  return (
    <Box minH="100vh" bg="var(--page-bg)">
      <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
        <Box borderBottomWidth="1px" borderColor="var(--border-subtle)">
          <Box maxW="1600px" mx="auto" px={{ base: 5, md: 8 }} pt={{ base: 8, md: 10 }}>
            <PlaygroundTabs value={activeTab} onChange={handleTabChange} />
          </Box>
        </Box>

        <Box maxW="1600px" mx="auto" px={{ base: 5, md: 8 }} pb={{ base: 8, md: 10 }}>
          <Stack gap={0} minH={{ base: 'calc(100vh - 64px)', md: 'calc(100vh - 80px)' }}>
            {activeTab === 'overview' ? (
              <Box pt={{ base: 6, md: 8 }}>
                <OverviewContent />
              </Box>
            ) : (
              <SimpleGrid
                flex="1"
                columns={{ base: 1, lg: 12 }}
                gap={{ base: 8, lg: 0 }}
                alignItems="stretch"
              >
                <Box
                  gridColumn={{ base: 'span 1', lg: 'span 3' }}
                  pt={{ base: 6, md: 8 }}
                  pb={{ base: 8, md: 10 }}
                  pr={{ base: 0, lg: 8 }}
                >
                  <PlaygroundControls
                    activeTab={activeTab}
                    expandedSections={expandedSections}
                    runStatus={runStatus}
                    imageCount={imageCount}
                    limitConcurrency={limitConcurrency}
                    maxConcurrent={maxConcurrent}
                    limitQueueDepth={limitQueueDepth}
                    maxQueueDepth={maxQueueDepth}
                    queuePolicy={queuePolicy}
                    crashPolicy={crashPolicy}
                    crashArmed={crashArmed}
                    runKey={runKeyRef.current}
                    onImageCountChange={setImageCount}
                    onLimitConcurrencyChange={setLimitConcurrency}
                    onMaxConcurrentChange={setMaxConcurrent}
                    onLimitQueueDepthChange={setLimitQueueDepth}
                    onMaxQueueDepthChange={setMaxQueueDepth}
                    onQueuePolicyChange={setQueuePolicy}
                    onCrashPolicyChange={setCrashPolicy}
                    onCrashNext={handleCrashNext}
                    onToggleSection={toggleSection}
                    onResetThroughput={resetThroughput}
                    onResetBackpressure={resetBackpressure}
                    onResetCrashes={resetCrashes}
                    onRun={handleRun}
                    onAbort={handleAbort}
                    onReset={handleReset}
                  />
                </Box>
                <Stack
                  gridColumn={{ base: 'span 1', lg: 'span 9' }}
                  gap={4}
                  borderLeftWidth={{ base: '0', lg: '1px' }}
                  borderColor="var(--border-subtle)"
                  pl={{ base: 0, lg: 8 }}
                  pt={{ base: 6, md: 8 }}
                  pb={{ base: 8, md: 10 }}
                  minH="full"
                >
                  <RuntimeSnapshotPanel runtime={runtime} onlyOnChange graph={graph} />
                  {status}
                </Stack>
              </SimpleGrid>
            )}
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}

export default Playground
