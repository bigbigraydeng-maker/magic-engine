/**
 * Generation Queue & Timeout Configuration
 * Controls concurrent generation limits, polling behavior, timeout protection,
 * and intelligent retry logic for image/video/avatar generation.
 */

export const GENERATION_CONFIG = {
  // Queue settings
  MAX_CONCURRENT_GENERATIONS: 2, // Maximum concurrent generation jobs
  POLLING_INTERVAL_MS: 5000, // Poll provider status every 5 seconds

  // Timeout settings
  POLLING_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes timeout for polling
  WARNING_TIMEOUT_MS: 6 * 60 * 1000, // 6 minutes warning threshold (wider window for user notification)
  PROVIDER_HARD_TIMEOUT_MS: 12 * 60 * 60 * 1000, // 12 hours (matches cron job)

  // Retry settings
  AUTO_RETRY_ENABLED: true,
  MAX_AUTO_RETRIES: 3,
  RETRY_DELAYS_MS: [
    1 * 60 * 1000, // 1 minute delay for first retry
    5 * 60 * 1000, // 5 minutes delay for second retry
    15 * 60 * 1000, // 15 minutes delay for third retry
  ],

  // Cost limits (for future billing controls)
  MAX_COST_PER_GENERATION_USD: 0.50,
} as const

/**
 * Represents a single item in the generation queue
 */
export interface GenerationQueueItem {
  postId: string
  assetId: string
  assetType: 'image' | 'video' | 'avatar_video'
  startedAt: number // Timestamp when generation started
  retryCount: number // Number of retry attempts
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'timeout'
  errorMessage?: string
  errorCode?: string
  costUsd?: number
  stage?: string // Current generation stage (e.g., "Initialising...")
  elapsed?: number // Seconds elapsed since start
  estimatedRemainingMs?: number // Estimated time remaining
}

/**
 * Complete state of the generation queue
 */
export interface GenerationQueueState {
  queue: GenerationQueueItem[] // Pending items waiting to start
  activeGenerations: Record<string, GenerationQueueItem> // Currently generating items
}

/**
 * Callbacks for queue state changes
 */
export interface GenerationQueueCallbacks {
  onStatusChange?: (postId: string, state: GenerationQueueItem) => void
  onQueueChange?: (queue: GenerationQueueState) => void
  onTimeout?: (postId: string, elapsedMs: number) => void
  onAutoRetry?: (postId: string, retryCount: number, delayMs: number) => void
}

/**
 * Error response from generation API
 */
export interface GenerationErrorResponse {
  code:
    | 'provider_error'
    | 'timeout'
    | 'invalid_input'
    | 'quota_exceeded'
    | 'auth_failed'
    | 'network_error'
  message: string
  retryEligible: boolean
  suggestedAction?: string
}

/**
 * Get the next retry delay based on retry count
 */
export function getRetryDelay(retryCount: number): number {
  if (retryCount >= GENERATION_CONFIG.RETRY_DELAYS_MS.length) {
    return GENERATION_CONFIG.RETRY_DELAYS_MS[
      GENERATION_CONFIG.RETRY_DELAYS_MS.length - 1
    ]
  }
  return GENERATION_CONFIG.RETRY_DELAYS_MS[retryCount]
}

/**
 * Check if a generation can be automatically retried
 */
export function canAutoRetry(retryCount: number): boolean {
  return (
    GENERATION_CONFIG.AUTO_RETRY_ENABLED &&
    retryCount < GENERATION_CONFIG.MAX_AUTO_RETRIES
  )
}

/**
 * Format elapsed time for display
 */
export function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Generation stages with display labels and weight percentages
 */
export const GENERATION_STAGES = [
  { key: 'initializing', label: 'Initialising…', weight_percent: 5 },
  { key: 'generating', label: 'Generating concept…', weight_percent: 50 },
  { key: 'rendering', label: 'Rendering pixels…', weight_percent: 35 },
  { key: 'finalizing', label: 'Finalising…', weight_percent: 10 },
] as const

/**
 * Asset-type-specific stage definitions
 */
export const GENERATION_STAGES_BY_TYPE = {
  image: [
    { key: 'initializing', label: 'Initialising…', weight_percent: 5 },
    { key: 'generating', label: 'Generating concept…', weight_percent: 50 },
    { key: 'rendering', label: 'Rendering pixels…', weight_percent: 35 },
    { key: 'finalizing', label: 'Finalising…', weight_percent: 10 },
  ],
  video: [
    { key: 'initializing', label: 'Initialising…', weight_percent: 5 },
    { key: 'generating', label: 'Generating frames…', weight_percent: 50 },
    { key: 'encoding', label: 'Encoding video…', weight_percent: 35 },
    { key: 'finalizing', label: 'Finalising…', weight_percent: 10 },
  ],
  avatar_video: [
    { key: 'initializing', label: 'Initialising…', weight_percent: 5 },
    { key: 'processing', label: 'Processing avatar…', weight_percent: 40 },
    { key: 'rendering', label: 'Rendering video…', weight_percent: 45 },
    { key: 'finalizing', label: 'Finalising…', weight_percent: 10 },
  ],
} as const

/**
 * Typical generation durations per provider x asset type (milliseconds)
 * Used to derive cancel thresholds and progress estimates
 */
const TYPICAL_DURATION_MS: Record<
  'wavespeed' | 'atlas' | 'openai' | 'seedance' | 'heygen',
  Partial<Record<'image' | 'video' | 'avatar_video', number>>
> = {
  wavespeed: { image: 180 * 1000, video: 300 * 1000 }, // legacy — kept for existing DB records
  atlas:     { image: 180 * 1000, video: 300 * 1000 }, // ~3 min image, ~5 min video
  openai:    { image: 20 * 1000 },                      // ~20s (synchronous, gpt-image-1)
  seedance:  { video: 240 * 1000, avatar_video: 300 * 1000 },
  heygen:    { avatar_video: 120 * 1000 },
}

/**
 * Return stages for a given asset type
 */
export function getStagesForType(
  assetType: 'image' | 'video' | 'avatar_video'
) {
  return GENERATION_STAGES_BY_TYPE[assetType]
}

/**
 * Return cancel-button activation threshold (1.5x typical duration)
 * Falls back to POLLING_TIMEOUT_MS when provider/type combo is unknown
 */
export function getCancelThresholdMs(
  provider: 'wavespeed' | 'atlas' | 'openai' | 'seedance' | 'heygen',
  assetType: 'image' | 'video' | 'avatar_video'
): number {
  const typicalMs =
    TYPICAL_DURATION_MS[provider][assetType] ??
    GENERATION_CONFIG.POLLING_TIMEOUT_MS
  return Math.round(typicalMs * 1.5)
}

/**
 * Get current stage based on elapsed time (cycles every 30 seconds per stage)
 */
export function getCurrentStage(elapsedSeconds: number): string {
  const stageIndex = Math.floor(elapsedSeconds / 30) % GENERATION_STAGES.length
  return GENERATION_STAGES[stageIndex].label
}

/**
 * Get estimated remaining time (heuristic based on provider)
 */
export function getEstimatedRemainingMs(
  elapsedMs: number,
  provider: 'wavespeed' | 'seedance' | 'heygen'
): number | undefined {
  const typicalDurations = {
    wavespeed: 180 * 1000,
    seedance: 240 * 1000,
    heygen: 120 * 1000,
  }

  const typicalMs = typicalDurations[provider]
  const remaining = Math.max(0, typicalMs - elapsedMs)
  return remaining > 0 ? remaining : undefined
}
