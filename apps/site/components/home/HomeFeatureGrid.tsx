import { Box, SimpleGrid, Stack, Tabs, Text } from '@chakra-ui/react'
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { useEffect, useState } from 'react'
import DefineDispatchVisual from './visuals/DefineDispatchVisual'

const createHighlighter = createBundledHighlighter({
  langs: {
    typescript: () => import('shiki/langs/typescript'),
  },
  themes: {
    'github-light': () => import('shiki/themes/github-light'),
  },
  engine: () => createJavaScriptRegexEngine(),
})

const { codeToHtml } = createSingletonShorthands(createHighlighter)

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
    let active = true
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
    }).then(result => {
      if (active) setHtml(result)
    })
    return () => {
      active = false
    }
  }, [code])

  return (
    <Box
      fontSize="xs"
      lineHeight="1.7"
      className="home-codeblock"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki outputs trusted HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const CodeTabs = () => (
  <Tabs.Root defaultValue="main" size="sm">
    <Box borderBottomWidth="1px" borderColor="var(--border-subtle)">
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
    </Box>
    {Object.entries(codeFiles).map(([id, code]) => (
      <Tabs.Content key={id} value={id} pt={4}>
        <Box h="280px" overflowY="auto">
          <CodeBlock code={code} />
        </Box>
      </Tabs.Content>
    ))}
  </Tabs.Root>
)

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
    <Text fontSize="xs" color="gray.400">
      [Backpressure animation]
    </Text>
  </Box>
)

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
    <Text fontSize="xs" color="gray.400">
      [Cancellation animation]
    </Text>
  </Box>
)

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
    <Text fontSize="xs" color="gray.400">
      [Crash recovery animation]
    </Text>
  </Box>
)

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
    <Text fontSize="xs" color="gray.400">
      [Observability animation]
    </Text>
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

const HomeFeatureGrid = () => {
  return (
    <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
      <Box maxW="var(--content-max-width)" mx="auto">
        <SimpleGrid columns={{ base: 1, md: 2 }}>
          <FeatureCell>
            <Stack gap={4}>
              <Stack gap={1}>
                  <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                    Define and Dispatch
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Define tasks once and call them like local methods.
                  </Text>
              </Stack>
              <Box pt={2}>
                <CodeTabs />
              </Box>
            </Stack>
          </FeatureCell>
          <FeatureCell borderLeft>
            <DefineDispatchVisual />
          </FeatureCell>
        </SimpleGrid>
      </Box>

      <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
        <Box maxW="var(--content-max-width)" mx="auto">
          <SimpleGrid columns={{ base: 1, md: 2 }}>
            <FeatureCell>
              <Stack gap={4}>
                <Stack gap={1}>
                  <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                    Predictable Backpressure
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Control pipeline concurrency, and decide whether to block, reject, or shed load when tasks are saturated.
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
                    Flexible Cancellation
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Cancel a job group by key across waiting, queued, and in‑flight work.
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

      <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
        <Box maxW="var(--content-max-width)" mx="auto">
          <SimpleGrid columns={{ base: 1, md: 2 }}>
            <FeatureCell>
              <Stack gap={4}>
                <Stack gap={1}>
                  <Text fontSize="xl" fontWeight="semibold" color="gray.900">
                    Crash Recovery
                  </Text>
                  <Text fontSize="sm" color="gray.600">
                    Choose whether in-flight work requeues or fails on crash.
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
                    Snapshots and event streams for metrics and traces.
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
  )
}

export default HomeFeatureGrid
