import { Button, HStack, Text } from '@chakra-ui/react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'

export const ControlDivider = () => null

export const ControlSectionHeader = ({
  title,
  isOpen,
  onToggle,
  onReset,
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
  onReset?: () => void
}) => (
  <HStack justify="space-between" p={3} cursor="pointer" onClick={onToggle} userSelect="none">
    <HStack gap={2}>
      {isOpen ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}
      <Text fontWeight="medium" fontSize="sm">
        {title}
      </Text>
    </HStack>
    {onReset && (
      <Button
        size="xs"
        variant="ghost"
        onClick={event => {
          event.stopPropagation()
          onReset()
        }}
      >
        Reset
      </Button>
    )}
  </HStack>
)
