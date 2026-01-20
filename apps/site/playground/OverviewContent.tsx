import { Box, SimpleGrid, Stack, Text } from '@chakra-ui/react'

const OverviewContent = () => (
  <Box bg="white" borderWidth="1px" borderColor="gray.200" rounded="lg" p={6}>
    <Stack gap={6}>
      <Stack gap={2}>
        <Text fontSize="xl" fontWeight="semibold">
          Image Processing Pipeline
        </Text>
        <Text color="gray.600">
          This demo shows a pipeline that processes images through three stages. Each stage runs in
          Web Workers, orchestrated by Atelier.
        </Text>
      </Stack>

      <Stack gap={4}>
        <Text fontWeight="medium">Pipeline Stages</Text>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <Box p={4} bg="blue.50" rounded="md">
            <Stack gap={2}>
              <Text fontWeight="medium" color="blue.800">
                Resize
              </Text>
              <Text fontSize="sm" color="blue.700">
                Parallel (4 workers)
              </Text>
              <Text fontSize="xs" color="gray.600">
                Resizing is CPU-bound but parallelizable. Multiple workers process images
                simultaneously for maximum throughput.
              </Text>
            </Stack>
          </Box>
          <Box p={4} bg="purple.50" rounded="md">
            <Stack gap={2}>
              <Text fontWeight="medium" color="purple.800">
                Analyze
              </Text>
              <Text fontSize="sm" color="purple.700">
                Singleton (1 worker)
              </Text>
              <Text fontSize="xs" color="gray.600">
                Analysis uses an ML model that's expensive to load. A singleton worker keeps the
                model warm between calls.
              </Text>
            </Stack>
          </Box>
          <Box p={4} bg="green.50" rounded="md">
            <Stack gap={2}>
              <Text fontWeight="medium" color="green.800">
                Enhance
              </Text>
              <Text fontSize="sm" color="green.700">
                Singleton (idle timeout)
              </Text>
              <Text fontSize="xs" color="gray.600">
                Enhancement is optional and bursty. The worker spins down after 10s of inactivity to
                free resources.
              </Text>
            </Stack>
          </Box>
        </SimpleGrid>
      </Stack>

      <Stack gap={4}>
        <Text fontWeight="medium">What to Explore</Text>
        <Stack gap={2} fontSize="sm" color="gray.600">
          <Text>
            <strong>Throughput:</strong> See how limiting parallel pipelines prevents the singleton
            bottleneck from being overwhelmed.
          </Text>
          <Text>
            <strong>Backpressure:</strong> Configure queue depth and policies to handle overload
            gracefully.
          </Text>
          <Text>
            <strong>Cancellation:</strong> Abort a running batch and observe how queued vs in-flight
            work is handled.
          </Text>
          <Text>
            <strong>Crashes:</strong> Inject a worker crash and see how different policies recover.
          </Text>
          <Text>
            <strong>Playground:</strong> Combine all settings and experiment freely.
          </Text>
        </Stack>
      </Stack>

      <Text fontSize="sm" color="gray.500">
        Select a tab above to start experimenting.
      </Text>
    </Stack>
  </Box>
)

export default OverviewContent
