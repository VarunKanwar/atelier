import { Badge, Box, HStack, SimpleGrid, Stack, Text } from '@chakra-ui/react'

import type { TaskRuntime } from '../../../src'
import { useRuntimeEvents } from '../useRuntimeEvents'

export type RuntimeEventsPanelProps = {
  runtime: TaskRuntime
  title?: string
}

const RuntimeEventsPanel = ({ runtime, title = 'Event stream' }: RuntimeEventsPanelProps) => {
  const { stats } = useRuntimeEvents(runtime)

  const counters = [
    { name: 'task.dispatch.total', label: 'Dispatched' },
    { name: 'task.success.total', label: 'Succeeded' },
    { name: 'task.failure.total', label: 'Failed' },
    { name: 'task.canceled.total', label: 'Canceled' },
    { name: 'task.rejected.total', label: 'Rejected' },
    { name: 'task.requeue.total', label: 'Requeued' },
    { name: 'worker.crash.total', label: 'Worker crashes' },
  ]

  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="xl" p={5}>
      <Stack gap={4}>
        <HStack justify="space-between">
          <Text fontWeight="semibold">{title}</Text>
          <Badge bg="gray.100" color="gray.700">
            Updated {new Date(stats.updatedAt).toLocaleTimeString()}
          </Badge>
        </HStack>

        <SimpleGrid columns={{ base: 1, sm: 2 }} gap={3}>
          {counters.map(counter => (
            <HStack key={counter.name} justify="space-between">
              <Text fontSize="xs" color="gray.500">
                {counter.label}
              </Text>
              <Text fontSize="sm" fontWeight="semibold">
                {stats.counters[counter.name] ?? 0}
              </Text>
            </HStack>
          ))}
        </SimpleGrid>

        <Stack gap={2}>
          <Text fontSize="sm" fontWeight="semibold">
            Latest histograms
          </Text>
          <HStack justify="space-between">
            <Text fontSize="xs" color="gray.500">
              queue.wait_ms
            </Text>
            <Text fontSize="sm" fontWeight="semibold">
              {stats.lastQueueWaitMs !== undefined ? `${stats.lastQueueWaitMs.toFixed(0)} ms` : '—'}
            </Text>
          </HStack>
          <HStack justify="space-between">
            <Text fontSize="xs" color="gray.500">
              task.duration_ms
            </Text>
            <Text fontSize="sm" fontWeight="semibold">
              {stats.lastTaskDurationMs !== undefined
                ? `${stats.lastTaskDurationMs.toFixed(0)} ms`
                : '—'}
            </Text>
          </HStack>
        </Stack>
      </Stack>
    </Box>
  )
}

export default RuntimeEventsPanel
