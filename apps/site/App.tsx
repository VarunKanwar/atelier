import { Box, HStack, Text } from '@chakra-ui/react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import Docs from './Docs'
import Home from './Home'
import Playground from './Playground'

const NavTab = ({ label, to, end }: { label: string; to: string; end?: boolean }) => {
  return (
    <NavLink to={to} end={end ?? false} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <Box
          px={1}
          py={2}
          fontSize="sm"
          fontWeight={isActive ? 'semibold' : 'medium'}
          color={isActive ? 'gray.900' : 'gray.600'}
          borderBottomWidth="2px"
          borderColor={isActive ? 'gray.900' : 'transparent'}
          transition="color 150ms ease, border-color 150ms ease"
          _hover={{ color: 'gray.900', borderColor: isActive ? 'gray.900' : 'gray.300' }}
        >
          {label}
        </Box>
      )}
    </NavLink>
  )
}

const App = () => {
  const base = import.meta.env.BASE_URL ?? '/'
  const normalizedBase = base === '/' ? '' : base.replace(/\/$/, '')

  return (
    <BrowserRouter basename={normalizedBase}>
      <Box minH="100vh">
        <Box bg="white" borderBottomWidth="1px" borderColor="gray.200">
          <Box maxW="var(--content-max-width)" mx="auto" px={{ base: 5, md: 8 }} py={3}>
            <HStack justify="space-between" align="center" flexWrap="wrap" gap={4}>
              <Text fontWeight="bold" fontSize="lg" letterSpacing="-0.01em">
                Atelier
              </Text>
              <HStack gap={5}>
                <NavTab label="Home" to="/" end />
                <NavTab label="Explore" to="/explore" />
                <NavTab label="Docs" to="/docs" />
              </HStack>
            </HStack>
          </Box>
        </Box>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Playground />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/*" element={<Docs />} />
        </Routes>
      </Box>
    </BrowserRouter>
  )
}

export default App
