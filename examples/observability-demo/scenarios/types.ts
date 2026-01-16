import type { FC } from 'react'

export type ScenarioMeta = {
  id: string
  title: string
  summary: string
  goal: string
}

export type ScenarioComponentProps = Record<string, never>

export type ScenarioDefinition = {
  meta: ScenarioMeta
  Component: FC<ScenarioComponentProps>
}
