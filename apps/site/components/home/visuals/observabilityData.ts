export type SpanStatus = 'ok' | 'error' | 'canceled'

export type SpanSegment = {
  start: number
  queue: number
  exec: number
  attempt?: number
}

export type ObservabilitySpan = {
  id: string
  label: string
  status: SpanStatus
  group: 'preprocess' | 'classify'
  segments: SpanSegment[]
}

export type ObservabilityTrace = {
  name: string
  spans: ObservabilitySpan[]
}

export const OBS_TRACE: ObservabilityTrace = {
  name: 'upload-batch-001',
  spans: [
    {
      id: 'preprocess-1',
      label: 'preprocess(img-1)',
      status: 'ok',
      group: 'preprocess',
      segments: [{ start: 0.05, queue: 0.04, exec: 0.14 }],
    },
    {
      id: 'preprocess-2',
      label: 'preprocess(img-2)',
      status: 'ok',
      group: 'preprocess',
      segments: [{ start: 0.09, queue: 0.05, exec: 0.16 }],
    },
    {
      id: 'preprocess-3',
      label: 'preprocess(img-3)',
      status: 'canceled',
      group: 'preprocess',
      segments: [{ start: 0.12, queue: 0.06, exec: 0.08 }],
    },
    {
      id: 'classify-1',
      label: 'classify(img-1)',
      status: 'ok',
      group: 'classify',
      segments: [{ start: 0.32, queue: 0.06, exec: 0.18 }],
    },
    {
      id: 'classify-2',
      label: 'classify(img-2)',
      status: 'ok',
      group: 'classify',
      segments: [
        { start: 0.38, queue: 0.18, exec: 0.1, attempt: 1 },
        { start: 0.7, queue: 0.04, exec: 0.12, attempt: 2 },
      ],
    },
  ],
}

export const OBS_GROUP_ORDER = ['preprocess', 'classify'] as const

export const segmentEnd = (segment: SpanSegment): number =>
  segment.start + segment.queue + segment.exec
