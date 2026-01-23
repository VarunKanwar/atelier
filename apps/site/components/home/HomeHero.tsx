import { Box, Button, HStack, Link, SimpleGrid, Stack, Tabs, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'

const installCommands = [
  { id: 'npm', label: 'npm', command: 'npm i @varunkanwar/atelier' },
  { id: 'pnpm', label: 'pnpm', command: 'pnpm add @varunkanwar/atelier' },
  { id: 'yarn', label: 'yarn', command: 'yarn add @varunkanwar/atelier' },
  { id: 'bun', label: 'bun', command: 'bun add @varunkanwar/atelier' },
]

const InstallTabs = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = async (command: string, id: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1400)
    } catch {
      setCopiedId(null)
    }
  }

  return (
    <Tabs.Root defaultValue="npm" size="sm">
      <HStack justify="space-between" borderBottomWidth="1px" borderColor="var(--border-subtle)">
        <Tabs.List border="none" gap={0}>
          {installCommands.map(item => (
            <Tabs.Trigger
              key={item.id}
              value={item.id}
              px={3}
              py={2}
              fontSize="sm"
              fontWeight="medium"
              color="gray.500"
              borderBottomWidth="2px"
              borderColor="transparent"
              roundedBottom="none"
              _selected={{ color: 'gray.900', borderColor: 'gray.900' }}
            >
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Text fontSize="xs" color="gray.400" pr={2}>
          bash
        </Text>
      </HStack>
      {installCommands.map(item => (
        <Tabs.Content key={item.id} value={item.id} pt={3} pb={1}>
          <HStack justify="space-between" align="center" gap={3}>
            <Text fontFamily="var(--font-mono)" fontSize="sm" color="gray.700">
              <Text as="span" color="gray.400">
                $
              </Text>{' '}
              {item.command}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              color="gray.500"
              onClick={() => handleCopy(item.command, item.id)}
            >
              {copiedId === item.id ? 'Copied' : 'Copy'}
            </Button>
          </HStack>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}

export type HomeHeroProps = {
  docsHref: string
  exploreHref: string
  githubHref: string
}

const HomeHero = ({ docsHref, exploreHref, githubHref }: HomeHeroProps) => {
  return (
    <Box
      maxW="var(--content-max-width)"
      mx="auto"
      px={{ base: 5, md: 8 }}
      pt={{ base: 12, md: 20 }}
      pb={{ base: 10, md: 16 }}
    >
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 8, lg: 16 }} alignItems="start">
        <Stack gap={6}>
          <Text
            fontSize={{ base: '3xl', md: '4xl', lg: '6xl' }}
            fontWeight="semibold"
            letterSpacing="-0.03em"
            lineHeight="1.1"
            color="gray.900"
          >
            The Missing Runtime for Web Workers
            {/* The missing runtime for browser compute */}
          </Text>
          <Text fontSize={{ base: 'lg', md: 'xl' }} color="gray.600" maxW="480px">
            Backpressure, cancellation, crash recovery, and observability for your browser-based workloads.
            {/* Handles backpressure, cancellation, crash recovery, and observability so you don't have to. */}
          </Text>
          <HStack gap={3} flexWrap="wrap">
            <Button asChild bg="gray.900" color="white" _hover={{ bg: 'gray.800' }}>
              <RouterLink to={docsHref}>Get Started</RouterLink>
            </Button>
            <Button asChild variant="outline" borderColor="var(--border-subtle)">
              <a href={githubHref} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </Button>
            <Link asChild fontSize="sm" color="gray.500" ml={1}>
              <RouterLink to={exploreHref}>Explore demo</RouterLink>
            </Link>
          </HStack>
        </Stack>
        <Box>
          <InstallTabs />
        </Box>
      </SimpleGrid>
    </Box>
  )
}

export default HomeHero
