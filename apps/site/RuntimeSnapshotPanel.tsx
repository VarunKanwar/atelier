import { Box, HStack, Progress, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import type { RuntimeTaskSnapshot, TaskRuntime } from '@varunkanwar/atelier'
import { useMemo } from 'react'
import type { FlowGraph } from './harness/flow-types'
import ScenarioFlowCanvas from './harness/ScenarioFlowCanvas'
import { useRuntimeSnapshot } from './useRuntimeSnapshot'

export type RuntimeSnapshotPanelProps = {
  runtime: TaskRuntime
  intervalMs?: number
  onlyOnChange?: boolean
  graph?: FlowGraph
}

const formatCount = (value?: number): number => value ?? 0

const getMax = (value?: number): number | undefined =>
  value !== undefined && Number.isFinite(value) ? value : undefined

const getAlertTone = (task: RuntimeTaskSnapshot): 'danger' | 'warning' | 'ok' => {
  const waiting = formatCount(task.waitingQueueDepth)
  if (waiting > 0) return 'danger'
  const pending = formatCount(task.pendingQueueDepth)
  const maxQueueDepth = getMax(task.maxQueueDepth)
  if (maxQueueDepth && pending / Math.max(1, maxQueueDepth) >= 0.8) return 'warning'
  return 'ok'
}

const MetricRow = ({ label, value }: { label: string; value: string }) => (
  <HStack justify="space-between" fontSize="xs" color="gray.600">
    <Text>{label}</Text>
    <Text fontWeight="semibold" color="gray.800">
      {value}
    </Text>
  </HStack>
)

const QueueBar = ({
  label,
  value,
  max,
  tone,
}: {
  label: string
  value: number
  max?: number
  tone: 'danger' | 'warning' | 'ok'
}) => {
  const palette = tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : 'blue'
  if (!max) {
    return (
      <HStack justify="space-between" fontSize="xs" color="gray.600">
        <Text>{label}</Text>
        <Text fontWeight="semibold" color="gray.800">
          {value} / ∞
        </Text>
      </HStack>
    )
  }
  return (
    <Progress.Root value={value} max={max} size="sm" colorPalette={palette}>
      <HStack justify="space-between" mb={1}>
        <Progress.Label fontSize="xs" color="gray.600">
          {label}
        </Progress.Label>
        <Progress.ValueText fontSize="xs" color="gray.700">
          {value}/{max}
        </Progress.ValueText>
      </HStack>
      <Progress.Track>
        <Progress.Range />
      </Progress.Track>
    </Progress.Root>
  )
}

const WorkerBars = ({ values = [] }: { values?: number[] }) => {
  if (!values.length) return null
  const max = Math.max(1, ...values)
  return (
    <HStack align="flex-end" gap={1} h="32px" mt={1}>
      {values.map((value, index) => (
        <Box
          key={`${index}-${value}`}
          w="10px"
          h={`${Math.max(6, (value / max) * 32)}px`}
          bg={value > 0 ? 'blue.400' : 'gray.200'}
          borderRadius="sm"
        />
      ))}
    </HStack>
  )
}

const TaskCard = ({ task }: { task: RuntimeTaskSnapshot }) => {
  const tone = getAlertTone(task)

  const inFlight = formatCount(task.queueDepth)
  const pending = formatCount(task.pendingQueueDepth)
  const waiting = formatCount(task.waitingQueueDepth)
  const maxInFlight = getMax(task.maxInFlight)
  const maxPending = getMax(task.maxQueueDepth)

  return (
    <Box>
      <Box minW={0}>
        <Text fontWeight="semibold" lineClamp={1}>
          {task.taskName ?? task.taskId}
        </Text>
        <Text fontSize="xs" color="gray.500">
          {task.type} · init {task.init}
        </Text>
      </Box>

      <Stack gap={2} mt={3}>
        <MetricRow
          label="Workers"
          value={`${formatCount(task.activeWorkers)}/${formatCount(task.totalWorkers)}`}
        />
        <MetricRow label="Policy" value={`${task.queuePolicy ?? 'block'}`} />
      </Stack>

      <Stack gap={2} mt={3}>
        <QueueBar label="In flight" value={inFlight} max={maxInFlight} tone={tone} />
        <QueueBar label="Pending" value={pending} max={maxPending} tone={tone} />
        <MetricRow label="Waiting" value={`${waiting}`} />
      </Stack>

      {task.type === 'parallel' ? (
        <Box mt={3}>
          <Text fontSize="xs" color="gray.600">
            In-flight by worker
          </Text>
          <WorkerBars values={task.queueDepthByWorker} />
        </Box>
      ) : null}
    </Box>
  )
}

const EmptyState = ({ label }: { label: string }) => (
  <Text fontSize="sm" color="gray.500">
    {label}
  </Text>
)

const RuntimeSnapshotPanel = ({
  runtime,
  intervalMs,
  onlyOnChange,
  graph,
}: RuntimeSnapshotPanelProps) => {
  const { snapshot } = useRuntimeSnapshot(runtime, {
    intervalMs,
    onlyOnChange,
    emitImmediately: true,
  })
  const tasks = useMemo(() => {
    return [...snapshot.tasks].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'parallel' ? -1 : 1
      return (a.taskName ?? a.taskId).localeCompare(b.taskName ?? b.taskId)
    })
  }, [snapshot.tasks])
  const parallelTasks = tasks.filter(task => task.type === 'parallel')
  const singletonTasks = tasks.filter(task => task.type === 'singleton')

  const content = graph ? (
    <ScenarioFlowCanvas graph={graph} snapshot={snapshot} />
  ) : (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={6}>
      <Box>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="semibold">Parallel pools</Text>
          <Text fontSize="xs" color="gray.600">
            {parallelTasks.length}
          </Text>
        </HStack>
        <Stack gap={4}>
          {parallelTasks.length === 0 ? (
            <EmptyState label="No parallel tasks registered." />
          ) : (
            parallelTasks.map(task => <TaskCard key={task.taskId} task={task} />)
          )}
        </Stack>
      </Box>

      <Box>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="semibold">Singleton workers</Text>
          <Text fontSize="xs" color="gray.600">
            {singletonTasks.length}
          </Text>
        </HStack>
        <Stack gap={4}>
          {singletonTasks.length === 0 ? (
            <EmptyState label="No singleton tasks registered." />
          ) : (
            singletonTasks.map(task => <TaskCard key={task.taskId} task={task} />)
          )}
        </Stack>
      </Box>
    </SimpleGrid>
  )

  return <Box pr={2}>{content}</Box>
}

export default RuntimeSnapshotPanel
