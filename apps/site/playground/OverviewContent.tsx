import { SimpleGrid, Stack, Text } from '@chakra-ui/react'

const OverviewContent = () => (
  <Stack gap={6} maxW="960px">
    <Stack gap={2}>
      <Text fontSize="xl" fontWeight="semibold">
        Image Processing Pipeline
      </Text>
      <Text color="gray.600">
        This demo shows a pipeline that processes images through three stages. Each stage runs in
        Web Workers, orchestrated by Atelier.
      </Text>
    </Stack>

    <Stack gap={3}>
      <Text fontWeight="medium">Pipeline stages</Text>
      <SimpleGrid columns={{ base: 1, md: 3 }} gap={{ base: 4, md: 6 }}>
        <Stack gap={2}>
          <Text fontWeight="semibold" color="gray.800">
            Resize
          </Text>
          <Text fontSize="sm" color="gray.500">
            Parallel (4 workers)
          </Text>
          <Text fontSize="sm" color="gray.600">
            Resizing is CPU-bound but parallelizable. Multiple workers process images simultaneously
            for maximum throughput.
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text fontWeight="semibold" color="gray.800">
            Analyze
          </Text>
          <Text fontSize="sm" color="gray.500">
            Singleton (1 worker)
          </Text>
          <Text fontSize="sm" color="gray.600">
            Analysis uses an ML model that's expensive to load. A singleton worker keeps the model
            warm between calls.
          </Text>
        </Stack>
        <Stack gap={2}>
          <Text fontWeight="semibold" color="gray.800">
            Enhance
          </Text>
          <Text fontSize="sm" color="gray.500">
            Singleton (idle timeout)
          </Text>
          <Text fontSize="sm" color="gray.600">
            Enhancement is optional and bursty. The worker spins down after 10s of inactivity to
            free resources.
          </Text>
        </Stack>
      </SimpleGrid>
    </Stack>

    <Stack gap={3}>
      <Text fontWeight="medium">What to try</Text>
      <Stack gap={2} fontSize="sm" color="gray.600">
        <Text>
          <Text as="span" fontWeight="semibold" color="gray.800">
            Throughput:
          </Text>{' '}
          See how limiting parallel pipelines prevents the singleton bottleneck from being
          overwhelmed.
        </Text>
        <Text>
          <Text as="span" fontWeight="semibold" color="gray.800">
            Backpressure:
          </Text>{' '}
          Configure queue depth and policies to handle overload gracefully.
        </Text>
        <Text>
          <Text as="span" fontWeight="semibold" color="gray.800">
            Cancellation:
          </Text>{' '}
          Abort a running batch and observe how queued vs in-flight work is handled.
        </Text>
        <Text>
          <Text as="span" fontWeight="semibold" color="gray.800">
            Crashes:
          </Text>{' '}
          Inject a worker crash and see how different policies recover.
        </Text>
        <Text>
          <Text as="span" fontWeight="semibold" color="gray.800">
            Playground:
          </Text>{' '}
          Combine all settings and experiment freely.
        </Text>
      </Stack>
    </Stack>

    <Text fontSize="sm" color="gray.500">
      Select a tab above to start experimenting.
    </Text>
  </Stack>
)

export default OverviewContent
