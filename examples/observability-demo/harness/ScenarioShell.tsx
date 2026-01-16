import { Box, SimpleGrid, Stack } from '@chakra-ui/react'

import type { ReactNode } from 'react'
import ScenarioTabs from './ScenarioTabs'

export type ScenarioShellProps = {
  controls: ReactNode
  main: ReactNode
  status?: ReactNode
}

const ScenarioShell = ({ controls, main, status }: ScenarioShellProps) => {
  return (
    <Box minH="100vh" bg="gray.50" px={{ base: 4, lg: 6 }} py={5}>
      <Box maxW="1600px" mx="auto">
        <Stack gap={5}>
          <ScenarioTabs />

          <SimpleGrid columns={{ base: 1, lg: 12 }} gap={5} alignItems="start">
            <Box
              gridColumn={{ base: 'span 1', lg: 'span 3' }}
              bg="white"
              borderWidth="1px"
              borderColor="gray.200"
              rounded="lg"
              overflow="hidden"
            >
              {controls}
            </Box>
            <Stack gridColumn={{ base: 'span 1', lg: 'span 9' }} gap={3}>
              {main}
              {status}
            </Stack>
          </SimpleGrid>
        </Stack>
      </Box>
    </Box>
  )
}

export default ScenarioShell
