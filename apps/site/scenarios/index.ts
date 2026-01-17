import { backpressureScenario } from './backpressure'
import { cancellationScenario } from './cancellation'
import { concurrencyScenario } from './concurrency'
import { crashRecoveryScenario } from './crash-recovery'

export const scenarios = [
  concurrencyScenario,
  backpressureScenario,
  cancellationScenario,
  crashRecoveryScenario,
]

export type { ScenarioDefinition } from './types'
