/**
 * 同一个根因报了很多次的待办，折成一次（PM 2026-10-12：邮件只发机器完成不了的事，别让他看重复的）。
 *
 * 只做两条、都有明确的「主因」在场才折：
 *  1. 全站 AI 账户余额用完（`ai_provider_exhausted`）在场时，各客户「AI 可见度体检全挂了 · 余额/配额用完」
 *     只是它的症状——PM 充一次值全好。症状改归开发栏（不删，开发欠账清单里还看得见）。
 *  2. 同一个客户同时有「Facebook / Instagram 授权断了」（`platform_connection_broken`）和
 *     「Facebook 私信同步连续失败」（`facebook_sync_failing`）——修法都是重新连接 Meta，留前一条。
 *
 * 没有主因在场就一条都不动：宁可多报，也不能让一个真问题躲在「已经有人报了」后面。
 */

import type { ManualItem } from './manual-item-types'

const QUOTA_LABEL = '余额/配额用完'

export interface FoldResult {
  items: ManualItem[]
  /** 因主因在场而改归开发栏的症状数 */
  demotedToDev: number
  /** 因同一修法已有另一条而去掉的重复数 */
  droppedDuplicates: number
}

export function foldRootCauseDuplicates(items: readonly ManualItem[]): FoldResult {
  const quotaRootPresent = items.some((i) => i.kind === 'ai_provider_exhausted')
  const brokenFbClients = new Set(
    items
      .filter((i) => i.kind === 'platform_connection_broken' && i.what.includes('Facebook'))
      .map((i) => i.client_id)
      .filter((id) => id !== ''),
  )

  let demotedToDev = 0
  let droppedDuplicates = 0
  const out: ManualItem[] = []

  for (const item of items) {
    if (quotaRootPresent && item.kind === 'ai_tracker_all_failed' && item.what.includes(QUOTA_LABEL)) {
      demotedToDev += 1
      out.push({ ...item, kind: 'ai_tracker_all_failed_dev' })
      continue
    }
    if (item.kind === 'facebook_sync_failing' && brokenFbClients.has(item.client_id)) {
      droppedDuplicates += 1
      continue
    }
    out.push(item)
  }

  return { items: out, demotedToDev, droppedDuplicates }
}
