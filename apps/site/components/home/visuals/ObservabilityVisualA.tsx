import { Box } from '@chakra-ui/react'
import { OBS_TRACE, segmentEnd, type SpanSegment } from './observabilityData'
import { useObservabilityTimeline } from './hooks/useObservabilityTimeline'

const VIEWBOX = { width: 280, height: 160 }
const PADDING = { x: 12, y: 12 }
const TRACE_HEADER_HEIGHT = 12
const TASK_GROUP_GAP = 6
const ROW_HEIGHT = 12
const BAR_HEIGHT = 5
const TIMELINE_X = PADDING.x + 8
const TIMELINE_WIDTH = VIEWBOX.width - TIMELINE_X - PADDING.x - 8

const COLORS = {
  frameBorder: 'var(--border-subtle)',
  frameHeaderBg: 'var(--surface-muted)',
  queueFill: 'var(--stroke-subtle)',
  execFill: 'var(--stroke-muted)',
  taskGroupBg: 'rgba(148, 163, 184, 0.08)',
} as const

const getBarOpacity = (progress: number, segment: SpanSegment, base: number) => {
  if (progress < segment.start) return base * 0.25
  if (progress > segmentEnd(segment)) return base * 0.65
  return base
}

// Group spans by task type
const TASK_GROUPS = [
  { spanIds: ['preprocess-1', 'preprocess-2', 'preprocess-3'] },
  { spanIds: ['classify-1', 'classify-2'] },
]

export default function ObservabilityVisualA() {
  const { progress, prefersReducedMotion } = useObservabilityTimeline()

  const spanMap = new Map(OBS_TRACE.spans.map(s => [s.id, s]))

  let currentY = PADDING.y + TRACE_HEADER_HEIGHT + 4

  const groupPositions = TASK_GROUPS.map(group => {
    const startY = currentY
    const spans = group.spanIds.map(id => spanMap.get(id)).filter(Boolean)
    const groupHeight = spans.length * ROW_HEIGHT + 6
    currentY += groupHeight + TASK_GROUP_GAP
    return { group, startY, spans, groupHeight }
  })

  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      minH={{ base: '140px', md: '160px' }}
      bg="transparent"
      rounded="lg"
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <svg
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        style={{ width: '100%', height: '100%' }}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Trace timeline showing task spans"
        role="img"
      >
        {/* Trace container frame */}
        <rect
          x={PADDING.x}
          y={PADDING.y}
          width={VIEWBOX.width - PADDING.x * 2}
          height={VIEWBOX.height - PADDING.y * 2}
          rx={4}
          fill="none"
          stroke={COLORS.frameBorder}
          strokeWidth={0.5}
        />

        {/* Trace header bar */}
        <rect
          x={PADDING.x}
          y={PADDING.y}
          width={VIEWBOX.width - PADDING.x * 2}
          height={TRACE_HEADER_HEIGHT}
          rx={4}
          fill={COLORS.frameHeaderBg}
        />
        <rect
          x={PADDING.x}
          y={PADDING.y + TRACE_HEADER_HEIGHT - 4}
          width={VIEWBOX.width - PADDING.x * 2}
          height={4}
          fill={COLORS.frameHeaderBg}
        />

        {/* Task groups */}
        {groupPositions.map(({ startY, spans, groupHeight }, groupIndex) => (
          <g key={groupIndex}>
            {/* Group background */}
            <rect
              x={PADDING.x + 4}
              y={startY}
              width={VIEWBOX.width - PADDING.x * 2 - 8}
              height={groupHeight}
              rx={3}
              fill={COLORS.taskGroupBg}
            />

            {/* Spans */}
            {spans.map((span, index) => {
              if (!span) return null
              const rowY = startY + 3 + index * ROW_HEIGHT + ROW_HEIGHT / 2

              return (
                <g key={span.id}>
                  {span.segments.map((segment, segmentIndex) => {
                    const segmentStart = TIMELINE_X + TIMELINE_WIDTH * segment.start
                    const queueWidth = Math.max(1, TIMELINE_WIDTH * segment.queue)
                    const execWidth = Math.max(1, TIMELINE_WIDTH * segment.exec)
                    const queueOpacity = prefersReducedMotion
                      ? 0.4
                      : getBarOpacity(progress, segment, 0.4)
                    const execOpacity = prefersReducedMotion
                      ? 0.8
                      : getBarOpacity(progress, segment, 0.8)
                    const transition = 'opacity 120ms ease-out'

                    return (
                      <g key={`${span.id}-${segmentIndex}`}>
                        <rect
                          x={segmentStart}
                          y={rowY - BAR_HEIGHT / 2}
                          width={queueWidth}
                          height={BAR_HEIGHT}
                          rx={1}
                          fill={COLORS.queueFill}
                          style={{ opacity: queueOpacity, transition }}
                        />
                        <rect
                          x={segmentStart + queueWidth}
                          y={rowY - BAR_HEIGHT / 2}
                          width={execWidth}
                          height={BAR_HEIGHT}
                          rx={1}
                          fill={COLORS.execFill}
                          style={{ opacity: execOpacity, transition }}
                        />
                      </g>
                    )
                  })}

                  {/* Status indicator */}
                  {span.status === 'ok' ? (
                    <circle
                      cx={VIEWBOX.width - PADDING.x - 10}
                      cy={rowY}
                      r={2}
                      fill={COLORS.execFill}
                      opacity={0.5}
                    />
                  ) : span.status === 'canceled' ? (
                    <g opacity={0.5}>
                      <line
                        x1={VIEWBOX.width - PADDING.x - 12}
                        y1={rowY - 2}
                        x2={VIEWBOX.width - PADDING.x - 8}
                        y2={rowY + 2}
                        stroke={COLORS.execFill}
                        strokeWidth={1}
                      />
                      <line
                        x1={VIEWBOX.width - PADDING.x - 8}
                        y1={rowY - 2}
                        x2={VIEWBOX.width - PADDING.x - 12}
                        y2={rowY + 2}
                        stroke={COLORS.execFill}
                        strokeWidth={1}
                      />
                    </g>
                  ) : null}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </Box>
  )
}
