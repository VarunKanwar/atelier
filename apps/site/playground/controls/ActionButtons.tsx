import { Button, HStack } from '@chakra-ui/react'
import type { RunStatus } from '../constants'

export type ActionButtonsProps = {
  runStatus: RunStatus
  onRun: () => void
  onAbort: () => void
  onReset: () => void
}

const ActionButtons = ({ runStatus, onRun, onAbort, onReset }: ActionButtonsProps) => {
  const isRunning = runStatus === 'running'
  return (
    <HStack gap={2}>
      <Button
        size="sm"
        bg="gray.900"
        color="white"
        _hover={{ bg: 'gray.800' }}
        _active={{ bg: 'gray.900' }}
        onClick={onRun}
        disabled={isRunning}
      >
        {isRunning ? 'Running...' : 'Run'}
      </Button>
      {isRunning && (
        <Button size="sm" variant="outline" borderColor="var(--border-subtle)" onClick={onAbort}>
          Abort
        </Button>
      )}
      <Button size="sm" variant="outline" borderColor="var(--border-subtle)" onClick={onReset}>
        Reset
      </Button>
    </HStack>
  )
}

export default ActionButtons
