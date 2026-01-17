import {
  Badge,
  Box,
  HStack,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
} from '@chakra-ui/react'
import { useMemo } from 'react'
import type { RuntimeTaskSnapshot, TaskRuntime } from '../../src'
import type { FlowGraph } from './harness/flow-types'
import ScenarioFlowCanvas from './harness/ScenarioFlowCanvas'
import { useRuntimeSnapshot } from './useRuntimeSnapshot'

export type RuntimeSnapshotPanelProps = {
  runtime: TaskRuntime
  title?: string
  intervalMs?: number
  onlyOnChange?: boolean
  graph?: FlowGraph
}

const formatLimit = (value?: number): string =>
  value === undefined || !Number.isFinite(value) ? '∞' : String(value)

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

const QueueLegend = () => (
  <Box borderWidth="1px" borderColor="gray.200" rounded="lg" p={3} bg="gray.50">
    <Text fontSize="xs" fontWeight="semibold" color="gray.700" mb={2}>
      Queue states (practical meaning)
    </Text>
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={2} fontSize="xs" color="gray.600">
      <Box>
        <Text fontWeight="semibold" color="gray.800">
          In flight
        </Text>
        <Text>Work is executing on a worker (active CPU time).</Text>
      </Box>
      <Box>
        <Text fontWeight="semibold" color="gray.800">
          Pending
        </Text>
        <Text>Accepted but not started. Backlog increases memory + latency.</Text>
      </Box>
      <Box>
        <Text fontWeight="semibold" color="gray.800">
          Waiting
        </Text>
        <Text>Caller paused before enqueue. Signal to reduce upstream work.</Text>
      </Box>
    </SimpleGrid>
  </Box>
)

const TaskCard = ({ task }: { task: RuntimeTaskSnapshot }) => {
  const tone = getAlertTone(task)
  const borderColor = tone === 'danger' ? 'red.200' : tone === 'warning' ? 'orange.200' : 'gray.200'
  const badgeColor = task.type === 'parallel' ? 'blue.50' : 'purple.50'
  const badgeText = task.type === 'parallel' ? 'blue.700' : 'purple.700'

  const inFlight = formatCount(task.queueDepth)
  const pending = formatCount(task.pendingQueueDepth)
  const waiting = formatCount(task.waitingQueueDepth)
  const maxInFlight = getMax(task.maxInFlight)
  const maxPending = getMax(task.maxQueueDepth)

  return (
    <Box borderWidth="1px" borderColor={borderColor} rounded="lg" p={4} bg="white">
      <HStack justify="space-between" align="flex-start" gap={3}>
        <Box minW={0}>
          <Text fontWeight="semibold" lineClamp={1}>
            {task.taskName ?? task.taskId}
          </Text>
          <Text fontSize="xs" color="gray.500">
            {task.type} · init {task.init}
          </Text>
        </Box>
        <Badge bg={badgeColor} color={badgeText}>
          {task.type === 'parallel' ? 'Parallel' : 'Singleton'}
        </Badge>
      </HStack>

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
  <Box borderWidth="1px" borderColor="gray.200" rounded="lg" p={6} bg="gray.50">
    <Text fontSize="sm" color="gray.500">
      {label}
    </Text>
  </Box>
)

const RuntimeSnapshotPanel = ({
  runtime,
  title = 'Runtime snapshot',
  intervalMs,
  onlyOnChange,
  graph,
}: RuntimeSnapshotPanelProps) => {
  const { snapshot, updatedAt } = useRuntimeSnapshot(runtime, {
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

  const tableContent = (
    <Table.ScrollArea borderWidth="1px" rounded="md">
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row bg="gray.50">
            <Table.ColumnHeader>Task</Table.ColumnHeader>
            <Table.ColumnHeader>Type</Table.ColumnHeader>
            <Table.ColumnHeader>Init</Table.ColumnHeader>
            <Table.ColumnHeader>Workers</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">In flight</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Pending</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Waiting</Table.ColumnHeader>
            <Table.ColumnHeader>Policy</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {tasks.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={8}>
                <Text fontSize="sm" color="gray.500">
                  No tasks registered yet.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            tasks.map(task => (
              <Table.Row key={task.taskId}>
                <Table.Cell>
                  <Text fontWeight="semibold">{task.taskName ?? task.taskId}</Text>
                  <Text fontSize="xs" color="gray.500">
                    {task.taskId}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Badge
                    bg={task.type === 'parallel' ? 'blue.50' : 'purple.50'}
                    color={task.type === 'parallel' ? 'blue.700' : 'purple.700'}
                  >
                    {task.type}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{task.init}</Table.Cell>
                <Table.Cell>
                  {formatCount(task.activeWorkers)}/{formatCount(task.totalWorkers)}
                </Table.Cell>
                <Table.Cell textAlign="end">
                  {formatCount(task.queueDepth)}/{formatLimit(task.maxInFlight)}
                </Table.Cell>
                <Table.Cell textAlign="end">
                  {formatCount(task.pendingQueueDepth)}/{formatLimit(task.maxQueueDepth)}
                </Table.Cell>
                <Table.Cell textAlign="end">{formatCount(task.waitingQueueDepth)}</Table.Cell>
                <Table.Cell>{task.queuePolicy ?? 'block'}</Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  )

  const graphContent = graph ? (
    <Stack gap={3}>
      <Text fontSize="sm" color="gray.500">
        Pipeline layout is demo-defined (not auto-inferred).
      </Text>
      <ScenarioFlowCanvas graph={graph} snapshot={snapshot} />
      <QueueLegend />
    </Stack>
  ) : (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={6}>
      <Box>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="semibold">Parallel pools</Text>
          <Badge bg="blue.50" color="blue.700">
            {parallelTasks.length}
          </Badge>
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
          <Badge bg="purple.50" color="purple.700">
            {singletonTasks.length}
          </Badge>
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

  return (
    <Box borderWidth="1px" borderColor="gray.200" rounded="xl" p={6} bg="white">
      <HStack justify="space-between" align="center" mb={4} gap={4}>
        <Box>
          <Text fontSize="lg" fontWeight="semibold">
            {title}
          </Text>
          <Text fontSize="xs" color="gray.500">
            Updated {new Date(updatedAt).toLocaleTimeString()}
          </Text>
        </Box>
        <Badge bg="gray.100" color="gray.700">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </Badge>
      </HStack>

      <Tabs.Root defaultValue="graph">
        <Tabs.List display="flex" gap={2} mb={4}>
          <Tabs.Trigger value="graph">Graph</Tabs.Trigger>
          <Tabs.Trigger value="table">Table</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="graph">
          <Box pr={2}>{graphContent}</Box>
        </Tabs.Content>

        <Tabs.Content value="table">
          <Box pr={2}>{tableContent}</Box>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  )
}

export default RuntimeSnapshotPanel
