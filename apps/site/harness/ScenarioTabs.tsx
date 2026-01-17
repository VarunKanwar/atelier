import { Tabs, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

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
    <Tabs.Root value={activeId} onValueChange={event => setActiveId(event.value)} size="sm">
      <Tabs.List>
        {scenarios.map(scenario => (
          <Tabs.Trigger key={scenario.meta.id} value={scenario.meta.id}>
            <Text>{scenario.meta.title}</Text>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  )
}

export default ScenarioTabs
