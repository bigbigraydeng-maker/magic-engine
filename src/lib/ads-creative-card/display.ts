/**
 * Plain-language display for the add-creative confirmation card.
 * Read-only: built from stored hold payload, no Meta writes.
 */

import { toPublicClipUrl } from '@/lib/factory/evaluate'
import type { CreativeAdStatus, CreativeOrder, CtaType } from './order'
import { imageFilename } from './order'

export const CTA_LABEL_ZH: Record<CtaType, string> = {
  LEARN_MORE: '了解更多',
  SIGN_UP: '登记',
  BOOK_TRAVEL: '预订',
  CONTACT_US: '联系我们',
  GET_QUOTE: '询价',
  APPLY_NOW: '立即申请',
  SHOP_NOW: '去购买',
  SUBSCRIBE: '订阅',
}

export interface AddCreativeCardDetail {
  readonly imageUrl: string | null
  readonly imageFilename: string
  readonly adName: string
  readonly headline: string
  readonly primaryText: string
  readonly ctaLabel: string
  readonly adSetLabel: string
  readonly newAdStatusLabel: string
  readonly confirmSentence: string
}

function statusLabel(status: CreativeAdStatus): string {
  return status === 'ACTIVE' ? '直接在投' : '先暂停'
}

function confirmSentence(status: CreativeAdStatus): string {
  if (status === 'ACTIVE') {
    return '确认后：在这个广告组里新建一条在投中的广告，用上面的图和文字；预算不变。'
  }
  return '确认后：在这个广告组里新建一条暂停中的广告，用上面的图和文字；预算不变。'
}

function adSetLabel(order: CreativeOrder, storedName: unknown): string {
  if (typeof storedName === 'string' && storedName.trim().length > 0) return storedName.trim()
  return order.adSetId
}

export function buildAddCreativeDisplay(
  order: CreativeOrder,
  storedAdSetName?: unknown,
): AddCreativeCardDetail {
  const ctaLabel = CTA_LABEL_ZH[order.ctaType] ?? '未记录'
  const nameMissing = typeof storedAdSetName !== 'string' || !storedAdSetName.trim()
  const adSet = adSetLabel(order, storedAdSetName)
  return {
    imageUrl: toPublicClipUrl(order.imagePath),
    imageFilename: imageFilename(order.imagePath),
    adName: order.adName,
    headline: order.headline,
    primaryText: order.primaryText,
    ctaLabel,
    adSetLabel: nameMissing ? `${adSet}（组名未记录）` : adSet,
    newAdStatusLabel: statusLabel(order.status),
    confirmSentence: confirmSentence(order.status),
  }
}