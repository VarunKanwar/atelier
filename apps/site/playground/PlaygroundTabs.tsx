import { Tabs } from '@chakra-ui/react'
import type { TabId } from './constants'

export type PlaygroundTabsProps = {
  value: TabId
  onChange: (next: TabId) => void
}

const PlaygroundTabs = ({ value, onChange }: PlaygroundTabsProps) => (
  <Tabs.Root value={value} onValueChange={event => onChange(event.value as TabId)} size="sm">
    <Tabs.List border="none" gap={0}>
      <Tabs.Trigger
        value="overview"
        px={3}
        py={2}
        fontSize="sm"
        fontWeight="medium"
        color="gray.500"
        borderBottomWidth="2px"
        borderColor="transparent"
        roundedBottom="none"
        _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
      >
        Overview
      </Tabs.Trigger>
      <Tabs.Trigger
        value="throughput"
        px={3}
        py={2}
        fontSize="sm"
        fontWeight="medium"
        color="gray.500"
        borderBottomWidth="2px"
        borderColor="transparent"
        roundedBottom="none"
        _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
      >
        Throughput
      </Tabs.Trigger>
      <Tabs.Trigger
        value="backpressure"
        px={3}
        py={2}
        fontSize="sm"
        fontWeight="medium"
        color="gray.500"
        borderBottomWidth="2px"
        borderColor="transparent"
        roundedBottom="none"
        _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
      >
        Backpressure
      </Tabs.Trigger>
      <Tabs.Trigger
        value="cancellation"
        px={3}
        py={2}
        fontSize="sm"
        fontWeight="medium"
        color="gray.500"
        borderBottomWidth="2px"
        borderColor="transparent"
        roundedBottom="none"
        _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
      >
        Cancellation
      </Tabs.Trigger>
      <Tabs.Trigger
        value="crashes"
        px={3}
        py={2}
        fontSize="sm"
        fontWeight="medium"
        color="gray.500"
        borderBottomWidth="2px"
        borderColor="transparent"
        roundedBottom="none"
        _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
      >
        Crashes
      </Tabs.Trigger>
      <Tabs.Trigger
        value="playground"
        px={3}
        py={2}
        fontSize="sm"
        fontWeight="medium"
        color="gray.500"
        borderBottomWidth="2px"
        borderColor="transparent"
        roundedBottom="none"
        _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
      >
        Playground
      </Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>
)

export default PlaygroundTabs
