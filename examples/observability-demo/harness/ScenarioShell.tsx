import { Box, Container, Heading, SimpleGrid, Stack, Text } from '@chakra-ui/react'

import type { ReactNode } from 'react'

export type ScenarioShellProps = {
  title: string
  summary: string
  goal: string
  controls: ReactNode
  rightPanel: ReactNode
  results: ReactNode
  notes?: ReactNode
}

const ScenarioShell = ({
  title,
  summary,
  goal,
  controls,
  rightPanel,
  results,
  notes,
}: ScenarioShellProps) => {
  return (
    <Box minH="100vh" bg="gray.50">
      <Container py={10} maxW="7xl">
        <Stack gap={6}>
          <Stack gap={3}>
            <Stack gap={1}>
              <Heading size="lg">{title}</Heading>
              <Text color="gray.600">{summary}</Text>
              <Text fontSize="sm" color="gray.500">
                Goal: {goal}
              </Text>
            </Stack>
          </Stack>

          <SimpleGrid columns={{ base: 1, lg: 12 }} gap={6} alignItems="start">
            <Box gridColumn={{ base: 'span 1', lg: 'span 4' }}>{controls}</Box>
            <Box gridColumn={{ base: 'span 1', lg: 'span 8' }}>{rightPanel}</Box>
          </SimpleGrid>

          <SimpleGrid columns={{ base: 1, lg: 12 }} gap={6} alignItems="start">
            <Box gridColumn={{ base: 'span 1', lg: 'span 8' }}>{results}</Box>
            {notes ? (
              <Box gridColumn={{ base: 'span 1', lg: 'span 4' }}>{notes}</Box>
            ) : null}
          </SimpleGrid>
        </Stack>
      </Container>
    </Box>
  )
}

export default ScenarioShell
