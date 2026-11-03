/**
 * Read-only 「发后成绩」view model: flat rows with T+4 / T+72 engagement, plain Chinese.
 */
import { PUBLISH_MEASUREMENT_OFFSETS_HOURS } from '@/lib/campaign/daily-plan-publish'
import {
  platformOfPublishPayload,
  platformOfStoryChannel,
  readingFromReceipt,
  receiptAtWindow,
  type PostMetric,
  type PublishActionRow,
  type Reading,
  type ReceiptRow,
  type StoryRow,
} from '@/lib/social/post-performance'

export const READBACK_DEFAULT_DAYS = 30
export const READBACK_MEASUREMENT_WINDOWS = PUBLISH_MEASUREMENT_OFFSETS_HOURS

const METRIC_LABELS: Record<PostMetric, string> = {
  likes: '赞',
  comments: '评',
  shares: '转',
}

export const READBACK_REASON_ZH: Record<string, string> = {
  no_receipt: '还没有读数回执',
  absent: '平台没返回这项',
  omitted_unverified: '未核实，不展示',
  field_absent: '读数缺失',
  unmeasurable: '这条读不到',
  story_insights_reader_not_built: '没有洞察权限，Story 观看读不到',
  no_readable_samples: '没有可读的样本',
  null_value: '数值为空',
  shares_7d_constant_zero_unverified: '汇总分享数不可信',
  retries_exhausted: '读数重试已用尽',
}

export type ReadbackWindowStatus = 'pending' | 'read' | 'missing'

export interface ReadbackMetricCell {
  label: string
  display: string
  detail: string | null
}

export interface ReadbackWindowBlock {
  hours: number
  title: string
  status: ReadbackWindowStatus
  status_label: string
  metrics: ReadbackMetricCell[]
}

export type ReadbackItemKind = 'image_post' | 'reel' | 'story'

export interface SocialReadbackItem {
  id: string
  kind: ReadbackItemKind
  kind_label: string
  platform_label: string
  published_at: string | null
  published_at_display: string
  story_sent: boolean | null
  story_registered: boolean | null
  windows: ReadbackWindowBlock[] | null
  summary: string | null
}

export interface SocialReadbackPanel {
  client_id: string
  since: string
  until: string
  limit: number
  generated_at: string
  items: SocialReadbackItem[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function payloadString(payload: unknown, key: string): string | null {
  const rec = asRecord(payload)
  if (rec === null) return null
  const v = rec[key]
  return typeof v === 'string' ? v : null
}

function parseTime(s: string | null): number | null {
  if (s === null) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function compareDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

export function formatReadbackTimeNz(iso: string | null): string {
  if (iso === null) return '时间未知'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '时间未知'
  return new Date(t).toLocaleString('zh-CN', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function reasonToZh(reason: string): string {
  return READBACK_REASON_ZH[reason] ?? reason
}

export function readingToCell(label: string, reading: Reading, windowStatus: ReadbackWindowStatus): ReadbackMetricCell {
  if (windowStatus === 'pending') {
    return { label, display: '—', detail: null }
  }
  if (reading.kind === 'value') {
    return { label, display: String(reading.value), detail: null }
  }
  return { label, display: '读不到', detail: reasonToZh(reading.reason) }
}

export function resolveWindowStatus(
  publishedAt: string | null,
  windowHours: number,
  receipt: ReceiptRow | null,
  now: Date,
): ReadbackWindowStatus {
  const anchorMs = parseTime(publishedAt)
  if (anchorMs === null) {
    return receipt === null ? 'missing' : 'read'
  }
  const dueMs = anchorMs + windowHours * 60 * 60 * 1000
  if (now.getTime() < dueMs) return 'pending'
  if (receipt === null) return 'missing'
  return 'read'
}

function windowStatusLabel(status: ReadbackWindowStatus): string {
  if (status === 'pending') return '还没到点'
  if (status === 'missing') return '过点没读到'
  return '已读'
}

function platformLabel(platform: string): string {
  if (platform === 'facebook') return 'Facebook'
  if (platform === 'instagram') return 'Instagram'
  if (platform === 'tiktok') return 'TikTok'
  if (platform === 'unknown') return '平台未标注'
  return platform
}

function kindFromSource(source: string | null): ReadbackItemKind | null {
  if (source === 'daily_plan') return 'image_post'
  if (source === 'factory_reel') return 'reel'
  return null
}

function kindLabel(kind: ReadbackItemKind): string {
  if (kind === 'image_post') return '图文'
  if (kind === 'reel') return 'Reel'
  return 'Story'
}

function buildEngagementWindows(
  publishedAt: string | null,
  receipts: ReceiptRow[],
  now: Date,
): ReadbackWindowBlock[] {
  return READBACK_MEASUREMENT_WINDOWS.map((hours) => {
    const receipt = receiptAtWindow(receipts, hours)
    const status = resolveWindowStatus(publishedAt, hours, receipt, now)
    const metrics: ReadbackMetricCell[] = (['likes', 'comments', 'shares'] as const).map((metric) =>
      readingToCell(METRIC_LABELS[metric], readingFromReceipt(receipt, metric), status),
    )
    return {
      hours,
      title: hours === 4 ? '发后 4 小时' : '发后 72 小时',
      status,
      status_label: windowStatusLabel(status),
      metrics,
    }
  })
}

function buildEngagementItem(
  action: PublishActionRow,
  receipts: ReceiptRow[],
  now: Date,
): SocialReadbackItem | null {
  const source = payloadString(action.payload, 'source')
  const kind = kindFromSource(source)
  if (kind === null) return null

  const publishedAt =
    payloadString(action.payload, 'published_at') ?? action.executed_at
  const platform = platformOfPublishPayload(action.payload)

  return {
    id: action.id,
    kind,
    kind_label: kindLabel(kind),
    platform_label: platformLabel(platform),
    published_at: publishedAt,
    published_at_display: formatReadbackTimeNz(publishedAt),
    story_sent: null,
    story_registered: null,
    windows: buildEngagementWindows(publishedAt, receipts, now),
    summary: null,
  }
}

function buildStoryItem(
  row: StoryRow,
  registeredItemIds: ReadonlySet<string>,
): SocialReadbackItem {
  const registered = registeredItemIds.has(row.item_id)
  return {
    id: row.item_id,
    kind: 'story',
    kind_label: kindLabel('story'),
    platform_label: platformLabel(platformOfStoryChannel(row.channel)),
    published_at: row.sent_at,
    published_at_display: formatReadbackTimeNz(row.sent_at),
    story_sent: true,
    story_registered: registered,
    windows: null,
    summary: registered
      ? '已发出并已登记；Story 没有公开的赞评转，观看数需要洞察权限，目前读不到。'
      : '已发出，尚未登记到读回系统；Story 没有公开的赞评转，观看数需要洞察权限，目前读不到。',
  }
}

export function parseStoryRegistrationItemIds(
  rows: Array<{ payload: unknown }>,
): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    const key = payloadString(row.payload, 'idempotency_key')
    if (key === null || !key.startsWith('story-lite:')) continue
    ids.add(key.slice('story-lite:'.length))
  }
  return ids
}

export function buildSocialReadbackPanel(input: {
  clientId: string
  since: string
  until: string
  limit: number
  now: Date
  actions: PublishActionRow[]
  receipts: ReceiptRow[]
  stories: StoryRow[]
  storyRegistrationRows: Array<{ payload: unknown }>
}): SocialReadbackPanel {
  const receiptsByAction = new Map<string, ReceiptRow[]>()
  for (const r of input.receipts) {
    const list = receiptsByAction.get(r.action_id)
    if (list === undefined) receiptsByAction.set(r.action_id, [r])
    else list.push(r)
  }

  const registeredStories = parseStoryRegistrationItemIds(input.storyRegistrationRows)
  const items: SocialReadbackItem[] = []

  for (const action of input.actions) {
    const receipts = receiptsByAction.get(action.id) ?? []
    const row = buildEngagementItem(action, receipts, input.now)
    if (row !== null) items.push(row)
  }

  for (const story of input.stories) {
    if (story.status !== 'SENT') continue
    items.push(buildStoryItem(story, registeredStories))
  }

  items.sort((a, b) => compareDesc(parseTime(a.published_at), parseTime(b.published_at)))
  const limited = items.slice(0, input.limit)

  return {
    client_id: input.clientId,
    since: input.since,
    until: input.until,
    limit: input.limit,
    generated_at: input.now.toISOString(),
    items: limited,
  }
}
