import {
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Portal,
  Select,
  Stack,
  Switch,
  Text,
} from '@chakra-ui/react'
import type { QueuePolicy } from '@varunkanwar/atelier'
import { useMemo } from 'react'
import { queuePolicies } from '../constants'
import { ControlDivider } from './ControlPrimitives'

export type BackpressureControlsProps = {
  imageCount: number
  limitQueueDepth: boolean
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  onImageCountChange: (value: number) => void
  onLimitQueueDepthChange: (value: boolean) => void
  onMaxQueueDepthChange: (value: number) => void
  onQueuePolicyChange: (value: QueuePolicy) => void
  onReset: () => void
  actionButtons: React.ReactNode
}

const BackpressureControls = ({
  imageCount,
  limitQueueDepth,
  maxQueueDepth,
  queuePolicy,
  onImageCountChange,
  onLimitQueueDepthChange,
  onMaxQueueDepthChange,
  onQueuePolicyChange,
  onReset,
  actionButtons,
}: BackpressureControlsProps) => {
  const queuePolicyCollection = useMemo(() => createListCollection({ items: queuePolicies }), [])

  return (
    <Stack gap={0}>
      <Box p={4}>
        <HStack justify="space-between" mb={3}>
          <Text fontWeight="medium" fontSize="sm">
            Backpressure
          </Text>
          <Button size="xs" variant="ghost" onClick={onReset}>
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
              onChange={event => onImageCountChange(Number(event.target.value))}
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
      <ControlDivider />
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )
}

export default BackpressureControls
