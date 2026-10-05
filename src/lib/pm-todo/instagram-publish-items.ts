/**
 * Instagram 交叉发布卡住 —— 只有人能修的那些，摆到今日待办里。
 *
 * Facebook Reel 发布后，工厂会通过 Publishing Hub 把同一条片交叉发到客户的
 * Instagram，回执写在 work order 的 output.instagram_publish 下（见
 * instagram-receipt.ts）。回执 status='failed' 且 needsHuman() 为真时，
 * 系统自己已经修不动了：
 *  - failure_kind='account'：Publishing Hub 那边的 Instagram 账号掉线/被取消授权，
 *    得人去 Publishing Hub 重新连。连好后系统每小时自动再试，这条待办会自己消失。
 *  - failure_kind='other' 且 next_retry_at=null：自动重试已放弃，得开发看。
 *
 * 判据（buildInstagramPublishItems）是纯函数，单独测；取数
 * （pushInstagramPublishItems）只读一张表，读失败由调用方兜底
 * （见 manual-items.ts 的 .catch）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { readReceipt, needsHuman, MAX_FB_AGE_MS } from '../factory/publish/instagram-receipt'

/** 只看最近这么多天发布过的 work order —— 更早的片也不自动补发了。 */
export const INSTAGRAM_ITEM_LOOKBACK_DAYS = 7

/** 单条待办里最多展示这么长的错误文本，免得把待办撑爆。 */
const SAMPLE_MAX_LEN = 120

export interface InstagramBlockedReceipt {
  work_order_id: string
  client_id: string
  /** unverified = 帖子发出去了,但 Publishing Hub 里读不到我们埋的防重复标记(对账可能失效) */
  failure_kind: 'account' | 'other' | 'unverified'
  error: string
  /** 已过 48 小时跟发窗口:系统不会再自动补发,只能人决定要不要手动处理 */
  expired?: boolean
}

/** 把错误文本压成单行并截断 —— 待办里只放一行，别带换行。 */
function toSample(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.slice(0, SAMPLE_MAX_LEN)
}

/**
 * 纯函数：把卡住的回执按 (客户, 失败类型) 分组，每组最多一条待办。
 * 顺序固定：先账号类，再 other 类；同类内按客户名排序，保证输出稳定可测。
 */
export function buildInstagramPublishItems(
  blocked: InstagramBlockedReceipt[],
  nameOf: (clientId: string) => string,
): ManualItem[] {
  const accountGroups = new Map<string, InstagramBlockedReceipt[]>()
  const otherGroups = new Map<string, InstagramBlockedReceipt[]>()
  const unverifiedGroups = new Map<string, InstagramBlockedReceipt[]>()

  const expiredGroups = new Map<string, InstagramBlockedReceipt[]>()

  for (const b of blocked) {
    const groups = b.expired === true ? expiredGroups : b.failure_kind === 'account' ? accountGroups : b.failure_kind === 'unverified' ? unverifiedGroups : otherGroups
    const existing = groups.get(b.client_id)
    if (existing === undefined) {
      groups.set(b.client_id, [b])
    } else {
      existing.push(b)
    }
  }

  const items: ManualItem[] = []

  const accountIds = [...accountGroups.keys()].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b)),
  )
  for (const clientId of accountIds) {
    const group = accountGroups.get(clientId) ?? []
    const name = nameOf(clientId)
    const count = group.length
    const sample = toSample(group[0]?.error ?? '')
    items.push({
      kind: 'instagram_account_disconnected',
      client_id: clientId,
      client_name: name,
      what: `【${name}】${count} 条视频没能同步到 Instagram —— Publishing Hub 里这个客户的 Instagram 账号好像掉线或被取消授权了(系统报:「${sample}」)。Facebook 那边不受影响,但 Instagram 上看不到这几条片`,
      how: `打开 Publishing Hub(链接在下面),找到「${name}」的 Instagram 账号,看有没有显示「需要重新连接」,有就点重新连接、按提示登录 Instagram。接好后系统每小时自动再试一次,不用再通知我;注意只会补发 Facebook 发出后 48 小时内的片,更早的不补(过期了)`,
      href: 'https://app.publer.com/',
    })
  }

  const otherIds = [...otherGroups.keys()].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b)),
  )
  for (const clientId of otherIds) {
    const group = otherGroups.get(clientId) ?? []
    const name = nameOf(clientId)
    const count = group.length
    const sample = toSample(group[0]?.error ?? '')
    items.push({
      kind: 'instagram_publish_failed',
      client_id: clientId,
      client_name: name,
      what: `【${name}】${count} 条视频自动同步到 Instagram 失败、已放弃重试(系统报:「${sample}」)。Facebook 那边不受影响`,
      how: `回我一句「查 Instagram 发布失败」,我去看原因;这几条不会自动重试`,
      href: 'https://app.magicengine.com.au/dashboard/factory',
    })
  }

  const unverifiedIds = [...unverifiedGroups.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  for (const clientId of unverifiedIds) {
    const count = (unverifiedGroups.get(clientId) ?? []).length
    const name = nameOf(clientId)
    items.push({
      kind: 'instagram_publish_failed',
      client_id: clientId,
      client_name: name,
      what: `【${name}】${count} 条视频已同步到 Instagram,但 Publishing Hub 里读不到系统埋的「防重复发布」标记 —— 以后万一中途出错,系统可能分不清有没有发过、存在重复发同一条的风险`,
      how: '回我一句「查 Instagram 防重复标记」,我去核实 Publishing Hub 是不是把那个看不见的标记吞了;在我查清前,别打开 Instagram 的真发开关',
      href: 'https://app.magicengine.com.au/dashboard/factory',
    })
  }

  const expiredIds = [...expiredGroups.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  for (const clientId of expiredIds) {
    const group = expiredGroups.get(clientId) ?? []
    const name = nameOf(clientId)
    items.push({
      kind: 'instagram_publish_failed',
      client_id: clientId,
      client_name: name,
      what: `【${name}】${group.length} 条视频没能同步到 Instagram,已超过 48 小时自动补发期,系统不会再试(系统报:「${toSample(group[0]?.error ?? '')}」)。Facebook 那边不受影响`,
      how: '决定这几条片还要不要补发到 Instagram:要的话回我一句「手动补发 Instagram」,我来处理;不要就回「放弃」,这条待办就收掉',
      href: 'https://app.magicengine.com.au/dashboard/factory',
    })
  }

  return items
}

/** Facebook 回执的发布时间还在跟发窗口内(读不出时间 = 不算,宁可少报不乱报) */
function isWithinFollowWindow(publishedRef: unknown, now: Date): boolean {
  if (typeof publishedRef !== 'object' || publishedRef === null) return false
  const at = (publishedRef as Record<string, unknown>).published_at
  const t = typeof at === 'string' ? Date.parse(at) : NaN
  return Number.isFinite(t) && now.getTime() - t <= MAX_FB_AGE_MS
}

/**
 * 读最近发布过的 Facebook work order，把卡住的 Instagram 回执下发成待办。
 *
 * 读失败直接抛，由调用方（manual-items.ts）的 .catch 兜住 —— 跟本文件其他
 * 通道同一条纪律：一条通道读挂了不拖垮别的待办。
 */
export async function pushInstagramPublishItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
): Promise<void> {
  const since = new Date(
    now.getTime() - INSTAGRAM_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, output, published_ref')
    .eq('status', 'published')
    .eq('published_ref->>platform', 'facebook')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw new Error('instagram publish items query failed: ' + error.message)

  const rows = (data ?? []) as Array<{
    id?: string
    client_id?: string
    output?: unknown
    published_ref?: unknown
  }>

  const blocked: InstagramBlockedReceipt[] = []
  for (const row of rows) {
    const receipt = readReceipt(row.output)
    if (receipt === null) continue
    // 超过「自动跟发窗口」的片系统不会再试了(见 MAX_FB_AGE_MS)—— 不能再挂「接好后会自动补发」,
    // 但失败也不能悄悄消失:改成「已错过自动补发、请决定是否手动处理」
    if (!isWithinFollowWindow(row.published_ref, now)) {
      if (receipt.status === 'failed') {
        blocked.push({ work_order_id: receipt.work_order_id, client_id: receipt.client_id, failure_kind: receipt.failure_kind ?? 'other', error: receipt.error ?? '', expired: true })
      }
      continue
    }
    if (receipt.idempotency_unverified === true && (receipt.status === 'draft' || receipt.status === 'scheduled')) {
      blocked.push({ work_order_id: receipt.work_order_id, client_id: receipt.client_id, failure_kind: 'unverified', error: '' })
      continue
    }
    if (!needsHuman(receipt)) continue
    if (receipt.failure_kind === undefined) continue
    blocked.push({
      work_order_id: receipt.work_order_id,
      client_id: receipt.client_id,
      failure_kind: receipt.failure_kind,
      error: receipt.error ?? '',
    })
  }

  items.push(...buildInstagramPublishItems(blocked, nameOf))
}
