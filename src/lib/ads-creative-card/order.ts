/**
 * One image ad into one existing ad set.
 * Destination and lead form are copied, never typed in.
 * A budget field is refused.
 */

import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { extractLeadFormId } from '@/lib/meta/readback'

export const CTA_TYPES = [
  'LEARN_MORE', 'SIGN_UP', 'BOOK_TRAVEL', 'CONTACT_US',
  'GET_QUOTE', 'APPLY_NOW', 'SHOP_NOW', 'SUBSCRIBE',
] as const

export type CtaType = (typeof CTA_TYPES)[number]
export type CreativeAdStatus = 'PAUSED' | 'ACTIVE'

export interface CreativeOrder {
  readonly adAccountId: string
  readonly adSetId: string
  readonly imagePath: string
  readonly primaryText: string
  readonly headline: string
  readonly ctaType: CtaType
  readonly adName: string
  readonly status: CreativeAdStatus
}

export interface CopiedStory {
  readonly sourceAdId: string
  readonly pageId: string
  readonly link: string | null
  readonly leadFormId: string | null
}

const KEYS = ['adAccountId', 'adSetId', 'imagePath', 'primaryText', 'headline', 'ctaType', 'adName', 'status']
const ACCOUNT_RE = /^act_\d{6,20}$/
const ADSET_RE = /^\d{1,32}$/
const ID_RE = /^[A-Za-z0-9_]{1,32}$/
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i

export function parseCreativeRequest(value: unknown, clientId: string): CreativeOrder {
  const row = asRow(value)
  rejectExtra(row)
  const imagePath = factoryImagePath(clientId, requireText(row.imagePath))
  if (!imagePath) throw new ConfirmationCardError('invalid', '这张图不在这个客户的内容工厂里，没有出卡。')
  return {
    adAccountId: match(row.adAccountId, ACCOUNT_RE, '广告账户编号不对，没有出卡。'),
    adSetId: match(row.adSetId, ADSET_RE, '广告组编号不对，没有出卡。'),
    imagePath,
    primaryText: plain(row.primaryText, 500, '正文请用一句人话。'),
    headline: plain(row.headline, 40, '标题请用一句短人话。'),
    ctaType: cta(row.ctaType),
    adName: plain(row.adName, 40, '广告名字请用一句短人话。'),
    status: readStatus(row),
  }
}

export function orderKey(order: CreativeOrder, copy: CopiedStory): string {
  return canonicalHashOfInput({ order, copy })
}

export function factoryImagePath(clientId: string, raw: string): string | null {
  if (!raw || /^[a-z]+:\/\//i.test(raw) || raw.includes('..') || raw.startsWith('/')) return null
  const path = raw.startsWith('content-factory/') ? raw.slice('content-factory/'.length) : raw
  if (!IMAGE_EXT.test(path) || path.length > 240) return null
  const owned = path.startsWith(`${clientId}/`)
    || path.startsWith(`renders/${clientId}/`)
    || path.startsWith(`clips/a-real/${clientId}/`)
    || path.startsWith(`clips/b-generated/${clientId}/`)
  return owned ? path : null
}

export function imageFilename(path: string): string {
  const name = path.split('/').pop() ?? ''
  return name.length > 0 ? name : 'image.jpg'
}

export function storyFor(order: CreativeOrder, copy: CopiedStory, imageHash: string): Record<string, unknown> {
  const lead = copy.leadFormId
  const link = lead ? 'https://fb.me/' : copy.link
  const value = lead ? { lead_gen_form_id: lead } : { link }
  return {
    page_id: copy.pageId,
    link_data: {
      message: order.primaryText,
      name: order.headline,
      image_hash: imageHash,
      link,
      call_to_action: { type: order.ctaType, value },
    },
  }
}

export function sameStory(left: CopiedStory, right: CopiedStory | null): boolean {
  if (!right) return false
  return left.sourceAdId === right.sourceAdId
    && left.pageId === right.pageId
    && left.link === right.link
    && left.leadFormId === right.leadFormId
}

export function copyFromAds(ads: readonly unknown[]): CopiedStory | null {
  for (const ad of ads) {
    const copy = copyFromAd(ad)
    if (copy) return copy
  }
  return null
}

function copyFromAd(ad: unknown): CopiedStory | null {
  if (!ad || typeof ad !== 'object') return null
  const row = ad as { id?: unknown; creative?: unknown }
  if (typeof row.id !== 'string' || !ID_RE.test(row.id)) return null
  const creative = row.creative
  if (!creative || typeof creative !== 'object') return null
  const spec = (creative as { object_story_spec?: unknown }).object_story_spec
  if (!spec || typeof spec !== 'object') return null
  const pageId = (spec as { page_id?: unknown }).page_id
  if (typeof pageId !== 'string' || !ID_RE.test(pageId)) return null
  const lead = extractLeadFormId(creative) ?? null
  if (lead && !ID_RE.test(lead)) return null
  const link = lead ? null : linkOf(spec as Record<string, unknown>)
  if (!lead && !link) return null
  return { sourceAdId: row.id, pageId, link, leadFormId: lead }
}

function linkOf(spec: Record<string, unknown>): string | null {
  for (const key of ['link_data', 'video_data'] as const) {
    const block = spec[key]
    if (!block || typeof block !== 'object') continue
    const direct = (block as { link?: unknown }).link
    if (typeof direct === 'string' && direct.startsWith('https://')) return direct
    const nested = (block as { call_to_action?: { value?: { link?: unknown } } }).call_to_action?.value?.link
    if (typeof nested === 'string' && nested.startsWith('https://')) return nested
  }
  return null
}

function asRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfirmationCardError('invalid', '一张卡只能往一个广告组加一条广告。')
  }
  return value as Record<string, unknown>
}

function rejectExtra(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (!KEYS.includes(key)) throw new ConfirmationCardError('invalid', '请求里带了这张卡不认识的内容，没有收下。')
  }
}

function readStatus(row: Record<string, unknown>): CreativeAdStatus {
  if (!Object.prototype.hasOwnProperty.call(row, 'status') || row.status === 'PAUSED') return 'PAUSED'
  if (row.status === 'ACTIVE') return 'ACTIVE'
  throw new ConfirmationCardError('invalid', '新广告只能先暂停，或在卡上写明直接在投。')
}

function cta(value: unknown): CtaType {
  if (typeof value === 'string' && (CTA_TYPES as readonly string[]).includes(value)) return value as CtaType
  throw new ConfirmationCardError('invalid', '按钮类型不在允许的清单里，没有出卡。')
}

function match(value: unknown, pattern: RegExp, reason: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ConfirmationCardError('invalid', reason)
  return value
}

function requireText(value: unknown): string {
  if (typeof value !== 'string') throw new ConfirmationCardError('invalid', '图片路径不对，没有出卡。')
  return value.trim()
}

function plain(value: unknown, max: number, reason: string): string {
  if (typeof value !== 'string') throw new ConfirmationCardError('invalid', reason)
  const text = value.trim()
  if (!text || text.length > max || /[{}[\]`]/.test(text)) throw new ConfirmationCardError('invalid', reason)
  return text
}
