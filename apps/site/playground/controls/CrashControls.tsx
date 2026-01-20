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
import { useMemo } from 'react'
import { crashPolicies } from '../constants'
import { ControlDivider } from './ControlPrimitives'

export type CrashControlsProps = {
  imageCount: number
  crashPolicy: CrashPolicy
  crashArmed: boolean
  onImageCountChange: (value: number) => void
  onCrashPolicyChange: (value: CrashPolicy) => void
  onCrashNext: () => void
  onReset: () => void
  actionButtons: React.ReactNode
}

const CrashControls = ({
  imageCount,
  crashPolicy,
  crashArmed,
  onImageCountChange,
  onCrashPolicyChange,
  onCrashNext,
  onReset,
  actionButtons,
}: CrashControlsProps) => {
  const crashPolicyCollection = useMemo(() => createListCollection({ items: crashPolicies }), [])

  return (
    <Stack gap={0}>
      <Box p={4}>
        <Stack gap={3}>
          <Stack gap={1}>
            <HStack justify="space-between">
              <Text fontWeight="medium" fontSize="sm">
                Crash Recovery
              </Text>
              <Button size="xs" variant="ghost" onClick={onReset}>
                Reset
              </Button>
            </HStack>
            <Text fontSize="xs" color="gray.500">
              Test how the system recovers when a worker crashes.
            </Text>
          </Stack>
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
      <ControlDivider />
      <Box p={4}>{actionButtons}</Box>
    </Stack>
  )
}

export default CrashControls
