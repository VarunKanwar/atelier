import { useMemo, useState } from 'react'

import { ScenarioNavProvider } from './harness/ScenarioTabs'
import { scenarios } from './scenarios'

const App = () => {
  const [activeId, setActiveId] = useState<string>(scenarios[0]?.meta.id ?? 'backpressure')
  const scenario = useMemo(
    () => scenarios.find(item => item.meta.id === activeId) ?? scenarios[0],
    [activeId]
  )

  if (!scenario) {
    return null
  }

  const Component = scenario.Component
  return (
    <ScenarioNavProvider scenarios={scenarios} activeId={activeId} setActiveId={setActiveId}>
      <Component />
    </ScenarioNavProvider>
  )
}

export default App
