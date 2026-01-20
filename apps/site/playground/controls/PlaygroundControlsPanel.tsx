import {
  Box,
  Button,
  Collapsible,
  createListCollection,
  HStack,
  Input,
  Portal,
  Select,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react'
import type { CrashPolicy, QueuePolicy } from '@varunkanwar/atelier'
import { useMemo } from 'react'
import { crashPolicies, queuePolicies } from '../constants'
import { ControlDivider, ControlSectionHeader } from './ControlPrimitives'

export type PlaygroundControlsPanelProps = {
  imageCount: number
  limitConcurrency: boolean
  maxConcurrent: number
  limitQueueDepth: boolean
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  crashPolicy: CrashPolicy
  crashArmed: boolean
  expandedSections: Set<string>
  runKey: string | null
  onImageCountChange: (value: number) => void
  onLimitConcurrencyChange: (value: boolean) => void
  onMaxConcurrentChange: (value: number) => void
  onLimitQueueDepthChange: (value: boolean) => void
  onMaxQueueDepthChange: (value: number) => void
  onQueuePolicyChange: (value: QueuePolicy) => void
  onCrashPolicyChange: (value: CrashPolicy) => void
  onCrashNext: () => void
  onToggleSection: (section: string) => void
  onResetThroughput: () => void
  onResetBackpressure: () => void
  onResetCrashes: () => void
  actionButtons: React.ReactNode
}

const PlaygroundControlsPanel = ({
  imageCount,
  limitConcurrency,
  maxConcurrent,
  limitQueueDepth,
  maxQueueDepth,
  queuePolicy,
  crashPolicy,
  crashArmed,
  expandedSections,
  runKey,
  onImageCountChange,
  onLimitConcurrencyChange,
  onMaxConcurrentChange,
  onLimitQueueDepthChange,
  onMaxQueueDepthChange,
  onQueuePolicyChange,
  onCrashPolicyChange,
  onCrashNext,
  onToggleSection,
  onResetThroughput,
  onResetBackpressure,
  onResetCrashes,
  actionButtons,
}: PlaygroundControlsPanelProps) => {
  const queuePolicyCollection = useMemo(() => createListCollection({ items: queuePolicies }), [])
  const crashPolicyCollection = useMemo(() => createListCollection({ items: crashPolicies }), [])

  return (
    <Stack gap={0}>
      <Collapsible.Root open={expandedSections.has('throughput')}>
        <ControlSectionHeader
          title="Throughput"
          isOpen={expandedSections.has('throughput')}
          onToggle={() => onToggleSection('throughput')}
          onReset={onResetThroughput}
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
                  onChange={event => onImageCountChange(Number(event.target.value))}
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
                    onCheckedChange={event => onLimitConcurrencyChange(event.checked)}
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
                    onChange={event => onMaxConcurrentChange(Number(event.target.value))}
                  />
                </Box>
              )}
            </Stack>
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>

      <ControlDivider />

      <Collapsible.Root open={expandedSections.has('backpressure')}>
        <ControlSectionHeader
          title="Backpressure"
          isOpen={expandedSections.has('backpressure')}
          onToggle={() => onToggleSection('backpressure')}
          onReset={onResetBackpressure}
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
                    onCheckedChange={event => onLimitQueueDepthChange(event.checked)}
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
                    onChange={event => onMaxQueueDepthChange(Number(event.target.value))}
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
                  onValueChange={event => {
                    const next = event.value[0] as QueuePolicy | undefined
                    if (next) onQueuePolicyChange(next)
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

      <ControlDivider />

      <Collapsible.Root open={expandedSections.has('cancellation')}>
        <ControlSectionHeader
          title="Cancellation"
          isOpen={expandedSections.has('cancellation')}
          onToggle={() => onToggleSection('cancellation')}
        />
        <Collapsible.Content>
          <Box px={4} pb={4}>
            <Stack gap={3}>
              <Text fontSize="xs" color="gray.500">
                Use Abort to cancel all in-progress and queued work.
              </Text>
              {runKey && (
                <Text fontSize="xs" color="gray.400">
                  Run key: {runKey}
                </Text>
              )}
            </Stack>
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>

      <ControlDivider />

      <Collapsible.Root open={expandedSections.has('crashes')}>
        <ControlSectionHeader
          title="Crash Recovery"
          isOpen={expandedSections.has('crashes')}
          onToggle={() => onToggleSection('crashes')}
          onReset={onResetCrashes}
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
                  onValueChange={event => {
                    const next = event.value[0] as CrashPolicy | undefined
                    if (next) onCrashPolicyChange(next)
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
                colorPalette={crashArmed ? 'orange' : 'gray'}
                onClick={onCrashNext}
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

      <ControlDivider />

      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )
}

export default PlaygroundControlsPanel
