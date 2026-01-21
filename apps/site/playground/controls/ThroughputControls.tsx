import { Box, Button, HStack, Input, Stack, Switch, Text } from '@chakra-ui/react'
import { ControlDivider } from './ControlPrimitives'

export type ThroughputControlsProps = {
  imageCount: number
  limitConcurrency: boolean
  maxConcurrent: number
  onImageCountChange: (value: number) => void
  onLimitConcurrencyChange: (value: boolean) => void
  onMaxConcurrentChange: (value: number) => void
  onReset: () => void
  actionButtons: React.ReactNode
}

const ThroughputControls = ({
  imageCount,
  limitConcurrency,
  maxConcurrent,
  onImageCountChange,
  onLimitConcurrencyChange,
  onMaxConcurrentChange,
  onReset,
  actionButtons,
}: ThroughputControlsProps) => (
  <Stack gap={0}>
    <Box p={4}>
      <HStack justify="space-between" mb={3}>
        <Text fontWeight="medium" fontSize="sm">
          Throughput
        </Text>
        <Button size="xs" variant="ghost" onClick={onReset}>
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
    <ControlDivider />
    <Box p={4}>{actionButtons}</Box>
  </Stack>
)

export default ThroughputControls
