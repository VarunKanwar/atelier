import { Box, HStack, Text } from '@chakra-ui/react'
import { Link as RouterLink, NavLink } from 'react-router-dom'

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

const SiteHeader = () => {
  return (
    <Box bg="white" borderBottomWidth="1px" borderColor="gray.200">
      <Box maxW="var(--content-max-width)" mx="auto" px={{ base: 5, md: 8 }} py={3}>
        <HStack justify="space-between" align="center" flexWrap="wrap" gap={4}>
          <Text
            as={RouterLink}
            to="/"
            fontWeight="bold"
            fontSize="lg"
            letterSpacing="-0.01em"
            textDecoration="none"
            color="gray.900"
            _hover={{ textDecoration: 'none', color: 'gray.900' }}
          >
            Atelier
          </Text>
          <HStack gap={5}>
            <NavTab label="Home" to="/" end />
            <NavTab label="Docs" to="/docs" />
            <NavTab label="Playground" to="/playground" />
          </HStack>
        </HStack>
      </Box>
    </Box>
  )
}

export default SiteHeader
