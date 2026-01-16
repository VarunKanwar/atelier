import { Box, HStack, Stack, Tabs, Text } from '@chakra-ui/react'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import type { ScenarioDefinition } from '../scenarios/types'

export type ScenarioNavContextValue = {
  scenarios: ScenarioDefinition[]
  activeId: string
  setActiveId: (id: string) => void
}

const ScenarioNavContext = createContext<ScenarioNavContextValue | null>(null)

export const ScenarioNavProvider = ({
  scenarios,
  activeId,
  setActiveId,
  children,
}: {
  scenarios: ScenarioDefinition[]
  activeId: string
  setActiveId: (id: string) => void
  children: ReactNode
}) => {
  return (
    <ScenarioNavContext.Provider value={{ scenarios, activeId, setActiveId }}>
      {children}
    </ScenarioNavContext.Provider>
  )
}

export const useScenarioNav = (): ScenarioNavContextValue => {
  const context = useContext(ScenarioNavContext)
  if (!context) {
    throw new Error('ScenarioNavProvider is missing')
  }
  return context
}

const ScenarioTabs = () => {
  const { scenarios, activeId, setActiveId } = useScenarioNav()

  return (
    <Box>
      <Stack gap={2} mb={4}>
        <Text fontWeight="semibold">Scenarios</Text>
        <Text fontSize="xs" color="gray.500">
          Switch demos while keeping the same layout.
        </Text>
      </Stack>
      <Tabs.Root
        orientation="vertical"
        value={activeId}
        onValueChange={event => setActiveId(event.value)}
        variant="plain"
        size="sm"
      >
        <Tabs.List display="flex" flexDirection="column" gap={1}>
          {scenarios.map(scenario => (
            <Tabs.Trigger key={scenario.meta.id} value={scenario.meta.id} justifyContent="flex-start">
              <HStack justify="space-between" w="full">
                <Text>{scenario.meta.title}</Text>
              </HStack>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
    </Box>
  )
}

export default ScenarioTabs
