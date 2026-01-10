import { ChakraProvider, defaultSystem } from '@chakra-ui/react'
import { createRoot } from 'react-dom/client'

import RuntimeObservabilityPage from './RuntimeObservabilityPage'

// biome-ignore lint/style/noNonNullAssertion: HTML template guarantees root element exists
createRoot(document.getElementById('root')!).render(
  <ChakraProvider value={defaultSystem}>
    <RuntimeObservabilityPage />
  </ChakraProvider>
)
