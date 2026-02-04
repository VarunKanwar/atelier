import { Box } from '@chakra-ui/react'
import { useObservabilityTimeline } from './hooks/useObservabilityTimeline'
import {
  OBS_GROUP_ORDER,
  OBS_TRACE,
  type ObservabilitySpan,
  type SpanSegment,
  segmentEnd,
} from './observabilityData'

const VIEWBOX = { width: 280, height: 160 }
const PADDING = { x: 12, y: 12 }
const TRACE_HEADER_HEIGHT = 12
const TASK_GROUP_GAP = 6
const ROW_HEIGHT = 12
const BAR_HEIGHT = 5
const GROUP_PADDING = 6
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
  const end = segmentEnd(segment)
  if (progress < end) return 0
  const revealWindow = 0.02
  const t = Math.min(1, Math.max(0, (progress - end) / revealWindow))
  return base * t
}

const getStatusOpacity = (progress: number, spanEnd: number, base: number) => {
  if (progress < spanEnd) return 0
  const revealWindow = 0.02
  const t = Math.min(1, Math.max(0, (progress - spanEnd) / revealWindow))
  return base * t
}

const buildGroupLayout = (spans: ObservabilitySpan[]) => {
  const grouped = OBS_GROUP_ORDER.map(key => ({
    key,
    spans: spans.filter(span => span.group === key),
  })).filter(group => group.spans.length > 0)

  let currentY = PADDING.y + TRACE_HEADER_HEIGHT + 4
  return grouped.map(group => {
    const groupHeight = group.spans.length * ROW_HEIGHT + GROUP_PADDING
    const startY = currentY
    currentY += groupHeight + TASK_GROUP_GAP
    return { ...group, startY, groupHeight }
  })
}

export default function ObservabilityVisual() {
  const { progress, prefersReducedMotion } = useObservabilityTimeline()
  const groupPositions = buildGroupLayout(OBS_TRACE.spans)

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
        {groupPositions.map(({ key: groupKey, startY, spans, groupHeight }) => (
          <g key={groupKey}>
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
              const spanEnd = Math.max(...span.segments.map(segment => segmentEnd(segment)))
              const statusOpacity = prefersReducedMotion
                ? 0.6
                : getStatusOpacity(progress, spanEnd, 0.6)
              const statusX = VIEWBOX.width - PADDING.x - 10

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

                  {/* Status indicator at span end */}
                  {span.status === 'ok' ? (
                    <g style={{ opacity: statusOpacity, transition: 'opacity 120ms ease-out' }}>
                      <line
                        x1={statusX - 1.5}
                        y1={rowY + 0.5}
                        x2={statusX - 0.2}
                        y2={rowY + 1.8}
                        stroke={COLORS.execFill}
                        strokeWidth={1}
                        strokeLinecap="round"
                      />
                      <line
                        x1={statusX - 0.2}
                        y1={rowY + 1.8}
                        x2={statusX + 2.6}
                        y2={rowY - 1.2}
                        stroke={COLORS.execFill}
                        strokeWidth={1}
                        strokeLinecap="round"
                      />
                    </g>
                  ) : span.status === 'canceled' || span.status === 'error' ? (
                    <g style={{ opacity: statusOpacity, transition: 'opacity 120ms ease-out' }}>
                      <line
                        x1={statusX - 1.6}
                        y1={rowY - 1.6}
                        x2={statusX + 1.6}
                        y2={rowY + 1.6}
                        stroke={COLORS.execFill}
                        strokeWidth={1}
                        strokeLinecap="round"
                      />
                      <line
                        x1={statusX + 1.6}
                        y1={rowY - 1.6}
                        x2={statusX - 1.6}
                        y2={rowY + 1.6}
                        stroke={COLORS.execFill}
                        strokeWidth={1}
                        strokeLinecap="round"
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
