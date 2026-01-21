import { Box, Input, Stack, Text } from '@chakra-ui/react'
import { ControlDivider } from './ControlPrimitives'

export type CancellationControlsProps = {
  imageCount: number
  runKey: string | null
  onImageCountChange: (value: number) => void
  actionButtons: React.ReactNode
}

const CancellationControls = ({
  imageCount,
  runKey,
  onImageCountChange,
  actionButtons,
}: CancellationControlsProps) => (
  <Stack gap={0}>
    <Box p={4}>
      <Text fontWeight="medium" fontSize="sm" mb={3}>
        Cancellation
      </Text>
      <Stack gap={3}>
        <Text fontSize="xs" color="gray.500">
          Start a run and use Abort to cancel all in-progress and queued work.
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
        {runKey && (
          <Text fontSize="xs" color="gray.400">
            Run key: {runKey}
          </Text>
        )}
      </Stack>
    </Box>
    <ControlDivider />
    <Box p={4}>{actionButtons}</Box>
  </Stack>
)

export default CancellationControls
