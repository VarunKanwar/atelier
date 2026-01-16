import { backpressureScenario } from './backpressure'
import { cancellationScenario } from './cancellation'
import { crashRecoveryScenario } from './crash-recovery'

export const scenarios = [backpressureScenario, cancellationScenario, crashRecoveryScenario]

export type { ScenarioDefinition } from './types'
