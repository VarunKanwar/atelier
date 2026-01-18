import { Box, HStack, Link, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

const quickStartMain = `import { createTaskRuntime } from '@varunkanwar/atelier'

type ResizeAPI = {
  process: (image: ImageData) => Promise<ImageData>
}

const runtime = createTaskRuntime()

const resize = runtime.defineTask<ResizeAPI>({
  type: 'parallel',
  worker: () => new Worker(new URL('./resize.worker.ts', import.meta.url), { type: 'module' }),
  keyOf: image => image.docId,
})

const result = await resize.process(image)`

const quickStartWorker = `import { expose } from 'comlink'
import { createTaskWorker, type TaskContext, type StripTaskContext } from '@varunkanwar/atelier'

const handlers = {
  async process(image: ImageData, ctx: TaskContext) {
    ctx.throwIfAborted()
    return resized
  },
}

export type ResizeAPI = StripTaskContext<typeof handlers>
expose(createTaskWorker(handlers))`

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'quickstart', label: 'Quick start' },
  { id: 'backpressure', label: 'Backpressure' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'observability', label: 'Observability' },
]

const CodeBlock = ({ code }: { code: string }) => (
  <Box
    as="pre"
    bg="gray.100"
    borderWidth="1px"
    borderColor="gray.200"
    rounded="md"
    p={4}
    fontSize="sm"
    overflowX="auto"
    fontFamily="mono"
    whiteSpace="pre"
  >
    {code}
  </Box>
)

const Section = ({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) => (
  <Stack id={id} gap={3} scrollMarginTop="96px" py={{ base: 6, md: 8 }}>
    <Text fontSize="lg" fontWeight="semibold">
      {title}
    </Text>
    {children}
  </Stack>
)

const Home = () => {
  const base = import.meta.env.BASE_URL ?? '/'
  const exploreHref = `${base}explore`

  return (
    <Box bgGradient="linear(to-b, gray.50, gray.100)" minH="100vh">
      <Box maxW="960px" mx="auto" px={{ base: 5, md: 10 }} py={{ base: 10, md: 14 }}>
        <Stack gap={10}>
          <Stack gap={4}>
            <Text fontSize={{ base: '3xl', md: '4xl' }} fontWeight="semibold" letterSpacing="-0.02em">
              Atelier
            </Text>
            <Text fontSize={{ base: 'md', md: 'lg' }} color="gray.700">
              Atelier is a browser-only task runtime for Web Worker workloads that need predictable
              concurrency, backpressure, and cancellation without adopting a pipeline DSL. It is
              intentionally small: a runtime, task proxies, and two executors backed by a shared
              queue.
            </Text>
            <Text fontSize={{ base: 'md', md: 'lg' }} color="gray.600">
              Use it when you have CPU-heavy or bursty work in the browser and you need to control
              how much work is in flight and what happens under load.
            </Text>
            <HStack gap={4} flexWrap="wrap" fontSize="sm" color="gray.700">
              <Link href="https://github.com/VarunKanwar/atelier" target="_blank" rel="noreferrer">
                GitHub
              </Link>
              <Link
                href="https://www.npmjs.com/package/@varunkanwar/atelier"
                target="_blank"
                rel="noreferrer"
              >
                npm
              </Link>
              <Link href={exploreHref}>Explore the demo</Link>
            </HStack>
          </Stack>

          <Box
            borderTopWidth="1px"
            borderBottomWidth="1px"
            borderColor="gray.200"
            py={3}
            bg="gray.50"
          >
            <HStack gap={{ base: 3, md: 5 }} flexWrap="wrap" fontSize="sm" color="gray.600">
              {sections.map(section => (
                <Link key={section.id} href={`#${section.id}`}>
                  {section.label}
                </Link>
              ))}
            </HStack>
          </Box>

          <Section id="overview" title="Overview">
            <Text color="gray.700">
              Every task call flows through a shared dispatch queue that enforces limits on how many
              calls can be in flight and how many can be waiting to dispatch. When a queue is full,
              you decide what happens next: wait at the call site, reject immediately, or drop work
              under load.
            </Text>
            <Text color="gray.700">
              Atelier does not define a pipeline language. Instead, it gives you a small runtime and
              a predictable queue so you can compose workflows with the control flow you already
              have.
            </Text>
          </Section>

          <Section id="quickstart" title="Quick start">
            <Stack gap={4}>
              <Text fontSize="sm" color="gray.500">
                Main thread
              </Text>
              <CodeBlock code={quickStartMain} />
              <Text fontSize="sm" color="gray.500">
                Worker
              </Text>
              <CodeBlock code={quickStartWorker} />
            </Stack>
          </Section>

          <Section id="backpressure" title="Backpressure">
            <Text color="gray.700">
              A task call moves through three phases: waiting (call-site blocked before admission),
              pending (accepted but not dispatched), and in-flight (running on a worker). This makes
              the pressure visible in your app: waiting means callers are being throttled; pending
              means accepted work is accumulating; in-flight means you are consuming worker time.
            </Text>
          </Section>

          <Section id="cancellation" title="Cancellation">
            <Text color="gray.700">
              If you provide a key function, the runtime can cancel all queued and in-flight work for
              that key. Timeouts are modeled as aborts, and worker handlers receive an AbortSignal so
              they can cooperate.
            </Text>
          </Section>

          <Section id="transfers" title="Zero-copy transfers">
            <Text color="gray.700">
              Large data types are transferred by default to avoid structured cloning. You can
              override transfer behavior per call to keep ownership or to keep results inside the
              worker when needed.
            </Text>
          </Section>

          <Section id="observability" title="Observability">
            <Text color="gray.700">
              The runtime exposes state snapshots and an event stream for metrics, spans, and traces.
              Spans are opt-in and sampled; events are only emitted when listeners are registered,
              keeping overhead low by default.
            </Text>
          </Section>
        </Stack>
      </Box>
    </Box>
  )
}

export default Home
