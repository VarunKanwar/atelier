import type { CrashPolicy, QueuePolicy } from '@varunkanwar/atelier'
import type { RunStatus, TabId } from './constants'
import ActionButtons from './controls/ActionButtons'
import BackpressureControls from './controls/BackpressureControls'
import CancellationControls from './controls/CancellationControls'
import CrashControls from './controls/CrashControls'
import PlaygroundControlsPanel from './controls/PlaygroundControlsPanel'
import ThroughputControls from './controls/ThroughputControls'

export type PlaygroundControlsProps = {
  activeTab: TabId
  expandedSections: Set<string>
  runStatus: RunStatus
  imageCount: number
  limitConcurrency: boolean
  maxConcurrent: number
  limitQueueDepth: boolean
  maxQueueDepth: number
  queuePolicy: QueuePolicy
  crashPolicy: CrashPolicy
  crashArmed: boolean
  runKey: string | null
  onImageCountChange: (value: number) => void
  onLimitConcurrencyChange: (value: boolean) => void
  onMaxConcurrentChange: (value: number) => void
  onLimitQueueDepthChange: (value: boolean) => void
  onMaxQueueDepthChange: (value: number) => void
  onQueuePolicyChange: (value: QueuePolicy) => void
  onCrashPolicyChange: (value: CrashPolicy) => void
  onCrashNext: () => void
  onToggleSection: (section: string) => void
  onResetThroughput: () => void
  onResetBackpressure: () => void
  onResetCrashes: () => void
  onRun: () => void
  onAbort: () => void
  onReset: () => void
}

const PlaygroundControls = ({
  activeTab,
  expandedSections,
  runStatus,
  imageCount,
  limitConcurrency,
  maxConcurrent,
  limitQueueDepth,
  maxQueueDepth,
  queuePolicy,
  crashPolicy,
  crashArmed,
  runKey,
  onImageCountChange,
  onLimitConcurrencyChange,
  onMaxConcurrentChange,
  onLimitQueueDepthChange,
  onMaxQueueDepthChange,
  onQueuePolicyChange,
  onCrashPolicyChange,
  onCrashNext,
  onToggleSection,
  onResetThroughput,
  onResetBackpressure,
  onResetCrashes,
  onRun,
  onAbort,
  onReset,
}: PlaygroundControlsProps) => {
  const actionButtons = (
    <ActionButtons runStatus={runStatus} onRun={onRun} onAbort={onAbort} onReset={onReset} />
  )

  if (activeTab === 'throughput') {
    return (
      <ThroughputControls
        imageCount={imageCount}
        limitConcurrency={limitConcurrency}
        maxConcurrent={maxConcurrent}
        onImageCountChange={onImageCountChange}
        onLimitConcurrencyChange={onLimitConcurrencyChange}
        onMaxConcurrentChange={onMaxConcurrentChange}
        onReset={onResetThroughput}
        actionButtons={actionButtons}
      />
    )
  }

  if (activeTab === 'backpressure') {
    return (
      <BackpressureControls
        imageCount={imageCount}
        limitQueueDepth={limitQueueDepth}
        maxQueueDepth={maxQueueDepth}
        queuePolicy={queuePolicy}
        onImageCountChange={onImageCountChange}
        onLimitQueueDepthChange={onLimitQueueDepthChange}
        onMaxQueueDepthChange={onMaxQueueDepthChange}
        onQueuePolicyChange={onQueuePolicyChange}
        onReset={onResetBackpressure}
        actionButtons={actionButtons}
      />
    )
  }

  if (activeTab === 'cancellation') {
    return (
      <CancellationControls
        imageCount={imageCount}
        runKey={runKey}
        onImageCountChange={onImageCountChange}
        actionButtons={actionButtons}
      />
    )
  }

  if (activeTab === 'crashes') {
    return (
      <CrashControls
        imageCount={imageCount}
        crashPolicy={crashPolicy}
        crashArmed={crashArmed}
        onImageCountChange={onImageCountChange}
        onCrashPolicyChange={onCrashPolicyChange}
        onCrashNext={onCrashNext}
        onReset={onResetCrashes}
        actionButtons={actionButtons}
      />
    )
  }

  if (activeTab === 'playground') {
    return (
      <PlaygroundControlsPanel
        imageCount={imageCount}
        limitConcurrency={limitConcurrency}
        maxConcurrent={maxConcurrent}
        limitQueueDepth={limitQueueDepth}
        maxQueueDepth={maxQueueDepth}
        queuePolicy={queuePolicy}
        crashPolicy={crashPolicy}
        crashArmed={crashArmed}
        expandedSections={expandedSections}
        runKey={runKey}
        onImageCountChange={onImageCountChange}
        onLimitConcurrencyChange={onLimitConcurrencyChange}
        onMaxConcurrentChange={onMaxConcurrentChange}
        onLimitQueueDepthChange={onLimitQueueDepthChange}
        onMaxQueueDepthChange={onMaxQueueDepthChange}
        onQueuePolicyChange={onQueuePolicyChange}
        onCrashPolicyChange={onCrashPolicyChange}
        onCrashNext={onCrashNext}
        onToggleSection={onToggleSection}
        onResetThroughput={onResetThroughput}
        onResetBackpressure={onResetBackpressure}
        onResetCrashes={onResetCrashes}
        actionButtons={actionButtons}
      />
    )
  }

  return null
}

export default PlaygroundControls
