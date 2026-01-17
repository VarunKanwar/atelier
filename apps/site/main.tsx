import { ChakraProvider, defaultSystem } from '@chakra-ui/react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'

import App from './App'

// biome-ignore lint/style/noNonNullAssertion: HTML template guarantees root element exists
createRoot(document.getElementById('root')!).render(
  <ChakraProvider value={defaultSystem}>
    <App />
  </ChakraProvider>
)
