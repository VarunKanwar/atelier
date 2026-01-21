import { Tabs } from '@chakra-ui/react'
import type { TabId } from './constants'

export type PlaygroundTabsProps = {
  value: TabId
  onChange: (next: TabId) => void
}

const PlaygroundTabs = ({ value, onChange }: PlaygroundTabsProps) => (
  <Tabs.Root value={value} onValueChange={event => onChange(event.value as TabId)} size="sm">
    <Tabs.List>
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="throughput">Throughput</Tabs.Trigger>
      <Tabs.Trigger value="backpressure">Backpressure</Tabs.Trigger>
      <Tabs.Trigger value="cancellation">Cancellation</Tabs.Trigger>
      <Tabs.Trigger value="crashes">Crashes</Tabs.Trigger>
      <Tabs.Trigger value="playground">Playground</Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>
)

export default PlaygroundTabs
