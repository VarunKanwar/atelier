import { Box, Button, HStack, Link, SimpleGrid, Stack, Tabs, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'

const CONTENT_MAX_WIDTH = 'var(--content-max-width)'

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
              <Text as="span" color="gray.400">$</Text> {item.command}
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

const codeFiles = {
  main: `import { createTaskRuntime } from '@varunkanwar/atelier'

const runtime = createTaskRuntime()

const imageOps = runtime.defineTask({
  type: 'parallel',
  worker: () => new Worker('./image.worker.ts', { type: 'module' }),
  poolSize: 4,
})

const classify = runtime.defineTask({
  type: 'singleton',
  worker: () => new Worker('./classify.worker.ts', { type: 'module' }),
})

for (const photo of album) {
  const processed = await imageOps.preprocess(photo)
  const [label, thumb] = await Promise.all([
    classify.analyze(processed),
    imageOps.thumbnail(processed),
  ])
}`,
  image: `import { createTaskWorker } from '@varunkanwar/atelier'

createTaskWorker({
  async preprocess(image, ctx) {
    ctx.throwIfAborted()
    // normalize, resize for ML input
    return processed
  },

  async thumbnail(image, ctx) {
    ctx.throwIfAborted()
    // generate preview
    return thumb
  },
})`,
  classify: `import { createTaskWorker } from '@varunkanwar/atelier'

createTaskWorker({
  async analyze(image, ctx) {
    ctx.throwIfAborted()
    // run classification model
    return { label: 'sunset', confidence: 0.94 }
  },
})`,
}

const CodeBlock = ({ code }: { code: string }) => {
  const [html, setHtml] = useState<string>('')

  useEffect(() => {
    codeToHtml(code, {
      lang: 'typescript',
      theme: 'github-light',
      transformers: [
        {
          pre(node) {
            node.properties.style = ''
          },
        },
      ],
    }).then(setHtml)
  }, [code])

  return (
    <Box
      fontSize="xs"
      lineHeight="1.7"
      sx={{
        '& pre': { m: 0, p: 0 },
        '& code': { fontFamily: 'var(--font-mono)' },
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const CodeTabs = () => (
  <Tabs.Root defaultValue="main" size="sm">
    <HStack borderBottomWidth="1px" borderColor="var(--border-subtle)">
      <Tabs.List border="none" gap={0}>
        {[
          { id: 'main', label: 'main.tsx' },
          { id: 'image', label: 'image.worker.ts' },
          { id: 'classify', label: 'classify.worker.ts' },
        ].map(item => (
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
    </HStack>
    {Object.entries(codeFiles).map(([id, code]) => (
      <Tabs.Content key={id} value={id} pt={4}>
        <Box h="280px" overflowY="auto">
          <CodeBlock code={code} />
        </Box>
      </Tabs.Content>
    ))}
  </Tabs.Root>
)

/** Placeholder: preprocess → (classify, thumbnail) flow */
const PipelinePlaceholder = () => (
  <Box
    h="100%"
    minH="300px"
    bg="var(--surface-muted)"
    rounded="lg"
    display="flex"
    alignItems="center"
    justifyContent="center"
  >
    <Stack align="center" gap={2}>
      <Text fontSize="sm" color="gray.500">preprocess → classify (singleton)</Text>
      <Text fontSize="sm" color="gray.500">→ thumbnail (pool)</Text>
      <Text fontSize="xs" color="gray.400" mt={2}>[Pipeline animation]</Text>
    </Stack>
  </Box>
)

/** Placeholder for backpressure animation */
const BackpressurePlaceholder = () => (
  <Box
    h="100%"
    minH="200px"
    bg="var(--surface-muted)"
    rounded="lg"
    display="flex"
    alignItems="center"
    justifyContent="center"
  >
    <Text fontSize="xs" color="gray.400">[Backpressure animation]</Text>
  </Box>
)

/** Placeholder for cancellation animation */
const CancellationPlaceholder = () => (
  <Box
    h="100%"
    minH="200px"
    bg="var(--surface-muted)"
    rounded="lg"
    display="flex"
    alignItems="center"
    justifyContent="center"
  >
    <Text fontSize="xs" color="gray.400">[Cancellation animation]</Text>
  </Box>
)

/** Placeholder for crash recovery animation */
const CrashRecoveryPlaceholder = () => (
  <Box
    h="100%"
    minH="200px"
    bg="var(--surface-muted)"
    rounded="lg"
    display="flex"
    alignItems="center"
    justifyContent="center"
  >
    <Text fontSize="xs" color="gray.400">[Crash recovery animation]</Text>
  </Box>
)

/** Placeholder for observability animation */
const ObservabilityPlaceholder = () => (
  <Box
    h="100%"
    minH="200px"
    bg="var(--surface-muted)"
    rounded="lg"
    display="flex"
    alignItems="center"
    justifyContent="center"
  >
    <Text fontSize="xs" color="gray.400">[Observability animation]</Text>
  </Box>
)

const FeatureCell = ({
  children,
  borderLeft = false,
  borderTop = false,
}: {
  children: React.ReactNode
  borderLeft?: boolean
  borderTop?: boolean
}) => (
  <Box
    p={{ base: 6, md: 8 }}
    borderColor="var(--border-subtle)"
    borderLeftWidth={{ base: '0', md: borderLeft ? '1px' : '0' }}
    borderTopWidth={borderTop ? '1px' : '0'}
  >
    {children}
  </Box>
)

const Home = () => {
  const base = import.meta.env.BASE_URL ?? '/'
  const docsHref = `${base}docs`
  const exploreHref = `${base}explore`
  const githubHref = 'https://github.com/anthropics/atelier'

  return (
    <Box minH="100vh">
      {/* Hero */}
      <Box maxW={CONTENT_MAX_WIDTH} mx="auto" px={{ base: 5, md: 8 }} pt={{ base: 12, md: 20 }} pb={{ base: 10, md: 16 }}>
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={{ base: 8, lg: 16 }} alignItems="start">
          <Stack gap={6}>
            <Text
              fontSize={{ base: '4xl', md: '5xl', lg: '6xl' }}
              fontWeight="semibold"
              letterSpacing="-0.03em"
              lineHeight="1.1"
              color="gray.900"
            >
              Task Runtime for Web Workers
            </Text>
            <Text fontSize={{ base: 'lg', md: 'xl' }} color="gray.600" maxW="480px">
              Backpressure, cancellation, crash recovery, and observability for browser workloads.
            </Text>
            <HStack gap={3} flexWrap="wrap">
              <Link href={docsHref}>
                <Button bg="gray.900" color="white" _hover={{ bg: 'gray.800' }}>
                  Get Started
                </Button>
              </Link>
              <Link href={githubHref} target="_blank" rel="noreferrer">
                <Button variant="outline" borderColor="var(--border-subtle)">
                  GitHub
                </Button>
              </Link>
              <Link href={exploreHref} fontSize="sm" color="gray.500" ml={1}>
                Explore demo →
              </Link>
            </HStack>
          </Stack>
          <Box>
            <InstallTabs />
          </Box>
        </SimpleGrid>
      </Box>

      {/* Feature grid - full-width lines */}
      <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
        {/* Row 1: Code + Pipeline animation */}
        <Box maxW={CONTENT_MAX_WIDTH} mx="auto">
          <SimpleGrid columns={{ base: 1, md: 2 }}>
            <FeatureCell>
              <Stack gap={4}>
                <Stack gap={1}>
                  <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                    Define and Dispatch
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Pool or singleton executors. One worker, multiple handlers.
                  </Text>
                </Stack>
                <Box pt={2}>
                  <CodeTabs />
                </Box>
              </Stack>
            </FeatureCell>
            <FeatureCell borderLeft>
              <PipelinePlaceholder />
            </FeatureCell>
          </SimpleGrid>
        </Box>

        {/* Row 2: Backpressure + Cancellation */}
        <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
          <Box maxW={CONTENT_MAX_WIDTH} mx="auto">
            <SimpleGrid columns={{ base: 1, md: 2 }}>
              <FeatureCell>
                <Stack gap={4}>
                  <Stack gap={1}>
                    <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                      Predictable Backpressure
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      Queue policies control what happens when workers are busy.
                    </Text>
                  </Stack>
                  <Box pt={2}>
                    <BackpressurePlaceholder />
                  </Box>
                </Stack>
              </FeatureCell>
              <FeatureCell borderLeft>
                <Stack gap={4}>
                  <Stack gap={1}>
                    <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                      Keyed Cancellation
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      Abort queued and in-flight work by key. Timeouts included.
                    </Text>
                  </Stack>
                  <Box pt={2}>
                    <CancellationPlaceholder />
                  </Box>
                </Stack>
              </FeatureCell>
            </SimpleGrid>
          </Box>
        </Box>

        {/* Row 3: Crash recovery + Observability */}
        <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
          <Box maxW={CONTENT_MAX_WIDTH} mx="auto">
            <SimpleGrid columns={{ base: 1, md: 2 }}>
              <FeatureCell>
                <Stack gap={4}>
                  <Stack gap={1}>
                    <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                      Crash Recovery
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      Workers crash. Choose whether in-flight work requeues or fails.
                    </Text>
                  </Stack>
                  <Box pt={2}>
                    <CrashRecoveryPlaceholder />
                  </Box>
                </Stack>
              </FeatureCell>
              <FeatureCell borderLeft>
                <Stack gap={4}>
                  <Stack gap={1}>
                    <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                      Runtime Observability
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      Snapshots and event streams. No external dependencies.
                    </Text>
                  </Stack>
                  <Box pt={2}>
                    <ObservabilityPlaceholder />
                  </Box>
                </Stack>
              </FeatureCell>
            </SimpleGrid>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default Home
