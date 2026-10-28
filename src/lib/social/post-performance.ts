import type { FieldRead } from '@/lib/meta/post-engagement'
import { SOCIAL_PLATFORMS, normalizePlatform, type SocialPlatform } from '@/lib/social/platforms'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Reading =
  | { kind: 'value'; value: number }
  | { kind: 'not_readable'; reason: string }

export type PostMetric = 'likes' | 'comments' | 'shares'

export const POST_METRICS: readonly PostMetric[] = ['likes', 'comments', 'shares']

export type PlatformOrUnknown = SocialPlatform | 'unknown'

/** One row of social_post_measurement_receipts (fields we read). values/missing are jsonb. */
export interface ReceiptRow {
  action_id: string
  window_hours: number
  status: string
  measured_at: string | null
  values: unknown
  missing: unknown
  reason: string | null
}

/** One row of flywheel_actions (social.publish_post). */
export interface PublishActionRow {
  id: string
  executed_at: string | null
  payload: unknown
}

/** One row of story_items (fields we read). */
export interface StoryRow {
  item_id: string
  channel: string
  status: string
  sent_at: string | null
  slot_at: string
}

/** One row of flywheel_metrics (page-level). */
export interface PageMetricRow {
  metric_key: string
  metric_value: number | null
  measured_at: string
}

export interface PostItem {
  action_id: string
  post_id: string | null
  permalink: string | null
  published_at: string | null
  platform: PlatformOrUnknown
  /** Window used for the numbers below: the largest window_hours having status ok or partial; null when none. */
  window_hours: number | null
  likes: Reading
  comments: Reading
  shares: Reading
}

export interface StoryItem {
  item_id: string
  channel: string
  sent_at: string | null
  views: Reading
}

export interface MetricSummary {
  n_items: number
  n_readable: number
  n_not_readable: number
  sum: Reading
}

export interface PlatformBlock {
  platform: PlatformOrUnknown
  status: 'has_data' | 'connected_no_data' | 'not_connected'
  /** Human label; exactly '该平台未接入' when status is not_connected. */
  label: string
  posts: { n: number; items: PostItem[]; metrics: Record<PostMetric, MetricSummary> }
  stories: { n: number; items: StoryItem[]; views: MetricSummary }
  page_level: Array<{ metric_key: string; measured_at: string; reading: Reading }>
}

export interface PostPerformanceReport {
  client_id: string
  since: string
  until: string
  limit: number
  /** Reel publish actions seen but deliberately not read here (Reel is a separate slice). */
  reel_actions_excluded: number
  platforms: PlatformBlock[]
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Plain non-array object, or null. Avoids `any` casts. */
function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseTime(s: string | null): number | null {
  if (s === null) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/** Descending by time; unparsable/null last. Stable for equal keys. */
function compareDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

// ---------------------------------------------------------------------------
// 1. fieldReadToReading
// ---------------------------------------------------------------------------

export function fieldReadToReading(f: FieldRead): Reading {
  if (f.kind === 'value') return { kind: 'value', value: f.value }
  if (f.kind === 'absent') return { kind: 'not_readable', reason: 'absent' }
  return { kind: 'not_readable', reason: 'omitted_unverified' }
}

// ---------------------------------------------------------------------------
// 2. platformOfPublishPayload
// ---------------------------------------------------------------------------

export function platformOfPublishPayload(payload: unknown): PlatformOrUnknown {
  const rec = asRecord(payload)
  if (rec === null) return 'unknown'
  const p = normalizePlatform(rec.platform)
  return p ?? 'unknown'
}

// ---------------------------------------------------------------------------
// 3. platformOfStoryChannel
// ---------------------------------------------------------------------------

export function platformOfStoryChannel(channel: string): PlatformOrUnknown {
  if (channel === 'facebook_story') return 'facebook'
  if (channel === 'instagram_story') return 'instagram'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// 4. readingFromReceipt
// ---------------------------------------------------------------------------

export function readingFromReceipt(receipt: ReceiptRow | null, metric: PostMetric): Reading {
  if (receipt === null) return { kind: 'not_readable', reason: 'no_receipt' }

  const values = asRecord(receipt.values)
  if (values !== null) {
    const v = values[metric]
    if (isFiniteNonNegative(v)) return { kind: 'value', value: v }
  }

  const missing = asRecord(receipt.missing)
  if (missing !== null) {
    const m = missing[metric]
    if (typeof m === 'string') return { kind: 'not_readable', reason: m }
  }

  if (receipt.status === 'unmeasurable') {
    return { kind: 'not_readable', reason: receipt.reason ?? 'unmeasurable' }
  }

  return { kind: 'not_readable', reason: 'field_absent' }
}

// ---------------------------------------------------------------------------
// 5. pickReceipt
// ---------------------------------------------------------------------------

export function pickReceipt(receipts: ReceiptRow[]): ReceiptRow | null {
  if (receipts.length === 0) return null

  let bestOk: ReceiptRow | null = null
  let bestAny: ReceiptRow | null = null

  for (const r of receipts) {
    if (bestAny === null || r.window_hours > bestAny.window_hours) bestAny = r
    if (r.status === 'ok' || r.status === 'partial') {
      if (bestOk === null || r.window_hours > bestOk.window_hours) bestOk = r
    }
  }

  return bestOk ?? bestAny
}

// ---------------------------------------------------------------------------
// 6. buildPostItem
// ---------------------------------------------------------------------------

export function buildPostItem(action: PublishActionRow, receipts: ReceiptRow[]): PostItem {
  const payload = asRecord(action.payload)

  const post_id = payload !== null ? stringOrNull(payload.post_id) : null
  const permalink = payload !== null ? stringOrNull(payload.permalink) : null
  const payloadPublishedAt = payload !== null ? stringOrNull(payload.published_at) : null
  const published_at = payloadPublishedAt ?? action.executed_at

  const platform = platformOfPublishPayload(action.payload)
  const receipt = pickReceipt(receipts)

  const window_hours =
    receipt !== null && (receipt.status === 'ok' || receipt.status === 'partial')
      ? receipt.window_hours
      : null

  return {
    action_id: action.id,
    post_id,
    permalink,
    published_at,
    platform,
    window_hours,
    likes: readingFromReceipt(receipt, 'likes'),
    comments: readingFromReceipt(receipt, 'comments'),
    shares: readingFromReceipt(receipt, 'shares'),
  }
}

// ---------------------------------------------------------------------------
// 7. buildStoryItem
// ---------------------------------------------------------------------------

export function buildStoryItem(row: StoryRow): StoryItem {
  return {
    item_id: row.item_id,
    channel: row.channel,
    sent_at: row.sent_at,
    // No Story performance reader exists yet.
    views: { kind: 'not_readable', reason: 'story_insights_reader_not_built' },
  }
}

// ---------------------------------------------------------------------------
// 8. summarizeMetric
// ---------------------------------------------------------------------------

export function summarizeMetric(readings: Reading[]): MetricSummary {
  let n_readable = 0
  let total = 0
  for (const r of readings) {
    if (r.kind === 'value') {
      n_readable += 1
      total += r.value
    }
  }
  const n_items = readings.length
  const n_not_readable = n_items - n_readable
  const sum: Reading =
    n_readable === 0
      ? { kind: 'not_readable', reason: 'no_readable_samples' }
      : { kind: 'value', value: total }
  return { n_items, n_readable, n_not_readable, sum }
}

// ---------------------------------------------------------------------------
// 9. buildPageLevel
// ---------------------------------------------------------------------------

const FB_PREFIX = 'social.fb.'
const SHARES_7D_KEY = 'social.fb.shares_7d'

export function buildPageLevel(
  rows: PageMetricRow[],
): Array<{ metric_key: string; measured_at: string; reading: Reading }> {
  // Keep the latest measured_at row per metric_key (Facebook-only).
  const latest = new Map<string, { row: PageMetricRow; t: number }>()

  for (const row of rows) {
    if (!row.metric_key.startsWith(FB_PREFIX)) continue
    const t = parseTime(row.measured_at)
    if (t === null) continue
    const prev = latest.get(row.metric_key)
    if (prev === undefined || t > prev.t) {
      latest.set(row.metric_key, { row, t })
    }
  }

  const keys = Array.from(latest.keys()).sort()
  return keys.map((key) => {
    const { row } = latest.get(key)!
    let reading: Reading
    if (key === SHARES_7D_KEY) {
      // Known: this aggregate is a constant 0 and must not be read as a real 0.
      reading = { kind: 'not_readable', reason: 'shares_7d_constant_zero_unverified' }
    } else if (isFiniteNumber(row.metric_value)) {
      reading = { kind: 'value', value: row.metric_value }
    } else {
      reading = { kind: 'not_readable', reason: 'null_value' }
    }
    return { metric_key: key, measured_at: row.measured_at, reading }
  })
}

// ---------------------------------------------------------------------------
// 10. buildPostPerformanceReport
// ---------------------------------------------------------------------------

function emptyMetrics(): Record<PostMetric, MetricSummary> {
  return {
    likes: summarizeMetric([]),
    comments: summarizeMetric([]),
    shares: summarizeMetric([]),
  }
}

function buildBlock(
  platform: PlatformOrUnknown,
  posts: PostItem[],
  stories: StoryItem[],
  pageLevel: Array<{ metric_key: string; measured_at: string; reading: Reading }>,
  connectedPlatforms: readonly SocialPlatform[],
): PlatformBlock {
  const metrics: Record<PostMetric, MetricSummary> = {
    likes: summarizeMetric(posts.map((p) => p.likes)),
    comments: summarizeMetric(posts.map((p) => p.comments)),
    shares: summarizeMetric(posts.map((p) => p.shares)),
  }

  const views = summarizeMetric(stories.map((s) => s.views))

  let status: PlatformBlock['status']
  let label: string

  if (platform === 'unknown') {
    status = 'has_data'
    label = '平台未标注（旧数据，不猜）'
  } else if (posts.length + stories.length + pageLevel.length > 0) {
    status = 'has_data'
    label = '有数据'
  } else if (connectedPlatforms.includes(platform)) {
    status = 'connected_no_data'
    label = '已接入，本窗口无数据'
  } else {
    status = 'not_connected'
    label = '该平台未接入'
  }

  return {
    platform,
    status,
    label,
    posts: { n: posts.length, items: posts, metrics },
    stories: { n: stories.length, items: stories, views },
    page_level: pageLevel,
  }
}

export function buildPostPerformanceReport(input: {
  clientId: string
  since: string
  until: string
  limit: number
  actions: PublishActionRow[]
  receipts: ReceiptRow[]
  stories: StoryRow[]
  pageMetrics: PageMetricRow[]
  connectedPlatforms?: readonly SocialPlatform[]
}): PostPerformanceReport {
  const connectedPlatforms = input.connectedPlatforms ?? []

  // Group receipts by action_id.
  const receiptsByAction = new Map<string, ReceiptRow[]>()
  for (const r of input.receipts) {
    const list = receiptsByAction.get(r.action_id)
    if (list === undefined) receiptsByAction.set(r.action_id, [r])
    else list.push(r)
  }

  // Split actions by payload.source.
  let reel_actions_excluded = 0
  const postItems: PostItem[] = []

  for (const action of input.actions) {
    const payload = asRecord(action.payload)
    const source = payload !== null ? payload.source : undefined

    if (source === 'factory_reel') {
      reel_actions_excluded += 1
      continue
    }
    if (source === 'daily_plan') {
      const receipts = receiptsByAction.get(action.id) ?? []
      postItems.push(buildPostItem(action, receipts))
      continue
    }
    // Any other source: dropped silently.
  }

  // Sort posts by published_at descending (unparsable last), then slice.
  postItems.sort((a, b) => compareDesc(parseTime(a.published_at), parseTime(b.published_at)))
  const limitedPosts = postItems.slice(0, input.limit)

  // Stories: only SENT, sorted by sent_at descending (null last), then slice.
  const storyItems = input.stories
    .filter((s) => s.status === 'SENT')
    .map(buildStoryItem)
  storyItems.sort((a, b) => compareDesc(parseTime(a.sent_at), parseTime(b.sent_at)))
  const limitedStories = storyItems.slice(0, input.limit)

  // Group by platform.
  const postsByPlatform = new Map<PlatformOrUnknown, PostItem[]>()
  for (const p of limitedPosts) {
    const list = postsByPlatform.get(p.platform)
    if (list === undefined) postsByPlatform.set(p.platform, [p])
    else list.push(p)
  }

  const storiesByPlatform = new Map<PlatformOrUnknown, StoryItem[]>()
  for (const s of limitedStories) {
    const platform = platformOfStoryChannel(s.channel)
    const list = storiesByPlatform.get(platform)
    if (list === undefined) storiesByPlatform.set(platform, [s])
    else list.push(s)
  }

  const platforms: PlatformBlock[] = []

  for (const platform of SOCIAL_PLATFORMS) {
    const posts = postsByPlatform.get(platform) ?? []
    const stories = storiesByPlatform.get(platform) ?? []
    const pageLevel = platform === 'facebook' ? buildPageLevel(input.pageMetrics) : []
    platforms.push(buildBlock(platform, posts, stories, pageLevel, connectedPlatforms))
  }

  // Extra 'unknown' block only if it has any post or story items.
  const unknownPosts = postsByPlatform.get('unknown') ?? []
  const unknownStories = storiesByPlatform.get('unknown') ?? []
  if (unknownPosts.length + unknownStories.length > 0) {
    platforms.push(buildBlock('unknown', unknownPosts, unknownStories, [], connectedPlatforms))
  }

  return {
    client_id: input.clientId,
    since: input.since,
    until: input.until,
    limit: input.limit,
    reel_actions_excluded,
    platforms,
  }
}

// ---------------------------------------------------------------------------
// 11. formatPostPerformanceText
// ---------------------------------------------------------------------------

/** Render a Reading: the number itself for a value (0 prints `0`), or 读不到(reason). */
function renderReading(r: Reading): string {
  if (r.kind === 'value') return String(r.value)
  return `读不到(${r.reason})`
}

export function formatPostPerformanceText(report: PostPerformanceReport): string {
  const lines: string[] = []
  lines.push(
    `客户 ${report.client_id} 窗口 ${report.since} ~ ${report.until}（Reel 动作已排除 ${report.reel_actions_excluded} 条）`,
  )

  for (const block of report.platforms) {
    lines.push(`【${block.platform}】${block.label}`)
    if (block.status === 'not_connected') continue

    lines.push(`图文Post n=${block.posts.n}`)
    for (const metric of POST_METRICS) {
      const m = block.posts.metrics[metric]
      lines.push(`  ${metric}: ${renderReading(m.sum)} (可读 ${m.n_readable}/${m.n_items})`)
    }

    lines.push(`Story n=${block.stories.n}`)
    const v = block.stories.views
    lines.push(`  views: ${renderReading(v.sum)} (可读 ${v.n_readable}/${v.n_items})`)

    for (const entry of block.page_level) {
      lines.push(`  ${entry.metric_key}: ${renderReading(entry.reading)}`)
    }
  }

  return lines.join('\n')
}
