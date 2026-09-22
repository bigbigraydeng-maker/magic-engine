/**
 * 每天把**所有在投的广告组**过一遍上线闸门。
 *
 * ── 为什么触发点必须是「每天扫」而不是「ME 建广告时」──────────────────────
 * 2026-08-05 子牙复审的第一刀：闸门原来只挂在「ME 自己建完广告」那一步，
 * 而 2026-08-04 真正得罪 Boris / Richard / Jude 那批广告**不是 ME 建的** ——
 * 是在 Meta 后台直接建的。规则写得再对，也永远轮不到它说话，覆盖率约等于 0。
 *
 * 改成按账户扫在投广告组之后，**谁建的都管**：ME 建的、FDE 手建的、客户自己
 * 建的、Meta 自动改过的，一视同仁。这也是这套东西唯一可能真的拦住事故的形态。
 *
 * ── 「查不出来」和「没问题」必须分开 ──────────────────────────────────────
 * 取数失败一律记成 `error`，不记成 0 条问题。本仓踩过同一类坑好几次：探针分不清
 * 两种结果，于是「没查到」被当成「没有」，静默失效几十天没人发现。
 *
 * 判在 `launch-readback.ts`（纯规则、可单测），取在 `lib/meta/readback.ts`，
 * 这里只负责串起来 + 按客户聚合。
 *
 * ── 2026-09-13 多账户 ────────────────────────────────────────────────────
 * 一个客户可能登记了不止一个 Meta 广告账户（`client_meta_ad_accounts`）——
 * CTS 就是：`meta_ad_account_id` 登记的账户之外，还有一个只在新表里的
 * "CTStours 官方账户"跑着 ThruPlay 广告，老逻辑只查 `meta_ad_account_id`，
 * 那个账户上的广告组从来没被这道每日闸门扫过。`sweepAllClients` 现在对每个
 * 客户都取完整账户列表，每个账户各产出一条 `ClientSweepResult`（`sweepClient`
 * 本身不用改，它一直就是"扫一个账户"）。
 *
 * 候选客户名单也从只看 `meta_ad_account_id` 改成
 * `getActiveClientsWithMetaAccounts`（同时看老列 + 新表）—— 否则如果哪天
 * 有人把某客户的主账户从设置页清空、但这个客户在新表里还登记着别的账户，
 * 这道安全巡检会把这个客户整个漏掉，等于绕了个圈又把这次要修的坑挖回来
 * （2026-09-13 子牙复审发现）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientAdAccountIds, getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import {
  listActiveAdSets,
  fetchAdCreativesReadback,
} from '@/lib/meta/readback'
import { adaptMetaAdSet } from './meta-readback-adapter'
import { checkLaunch, type LaunchFinding } from './launch-readback'

/** 一个广告组扫完的结果。 */
export interface SweptAdSet {
  adSetId: string
  adSetName: string
  findings: LaunchFinding[]
  /** 有 blocker = 这个组现在正在花钱做一件已知会出事的事。 */
  hasBlocker: boolean
  /** 买家实际会看到的每一句 —— 出问题时人要能直接读到，不用再去后台翻。 */
  buyerWillSee: { adName: string; lines: string[] }[]
}

export interface ClientSweepResult {
  clientId: string
  clientName: string
  adAccountId: string
  /** 扫过的广告组数。取数失败时是 0，且 error 有值 —— 别把它读成「都干净」。 */
  adSetsChecked: number
  blockers: number
  warns: number
  adSets: SweptAdSet[]
  error?: string
}

export interface SweepClient {
  id: string
  name: string
  meta_ad_account_id: string | null
  /** 客户所在地区，用来对照投放地区。没有就跳过那条检查。 */
  expected_geo?: string | null
  /** 客户行业（`clients.industry`），闸门文案从广告剧本取叫法。没有就用中性词。 */
  industry?: string | null
}

/** 一个组最多回读多少条广告的文案 —— 上游 `fetchAdCreativesReadback` 已限 50。 */
const MAX_ADSETS_PER_CLIENT = 100

/**
 * 扫一个客户。
 *
 * 单个广告组回读失败**不中断**其余组：一个组查不出来不该让今天整个客户都不扫。
 * 但失败的组会留一条 `readback_failed`，免得它悄悄从统计里消失。
 */
export async function sweepClient(client: SweepClient): Promise<ClientSweepResult> {
  const base = {
    clientId: client.id,
    clientName: client.name,
    adAccountId: client.meta_ad_account_id ?? '',
    adSetsChecked: 0,
    blockers: 0,
    warns: 0,
    adSets: [] as SweptAdSet[],
  }

  if (!client.meta_ad_account_id) {
    return { ...base, error: '这个客户没配广告账户' }
  }

  const token = await getMetaTokenForClient(client.id)
  if (!token) {
    return { ...base, error: '拿不到这个客户的 Meta 授权' }
  }

  const rawAdSets = await listActiveAdSets(client.meta_ad_account_id, token)
  if (rawAdSets === null) {
    return { ...base, error: '列不出在投的广告组（Meta 没给结果）' }
  }

  const swept: SweptAdSet[] = []
  for (const raw of rawAdSets.slice(0, MAX_ADSETS_PER_CLIENT)) {
    const name = typeof raw.name === 'string' ? raw.name : raw.id

    const creatives = await fetchAdCreativesReadback(raw.id, token)
    if (creatives === null) {
      swept.push({
        adSetId: raw.id,
        adSetName: name,
        hasBlocker: false,
        buyerWillSee: [],
        findings: [
          {
            code: 'readback_failed',
            severity: 'warn',
            message: `「${name}」的广告文案没回读到 —— 这条是「查不出来」，不是「没问题」。`,
            learnedFrom: '本仓通病：探针分不清「没查到」和「没有」，静默失效几十天',
          },
        ],
      })
      continue
    }

    const report = checkLaunch({
      ...adaptMetaAdSet(raw, creatives, { expectedGeo: client.expected_geo ?? null }),
      industry: client.industry ?? null,
    })
    swept.push({
      adSetId: raw.id,
      adSetName: name,
      findings: report.findings,
      hasBlocker: !report.safeToActivate,
      buyerWillSee: report.buyerWillSee,
    })
  }

  if (rawAdSets.length > MAX_ADSETS_PER_CLIENT) {
    // 截断必须说出来 —— 不说的话，这份报告读起来像「全都扫过了」。
    console.warn(
      `[readback-sweep] ${client.name} 有 ${rawAdSets.length} 个在投广告组，` +
        `本次只扫了前 ${MAX_ADSETS_PER_CLIENT} 个`,
    )
  }

  const all = swept.flatMap((s) => s.findings)
  return {
    ...base,
    adSetsChecked: swept.length,
    blockers: all.filter((f) => f.severity === 'blocker').length,
    warns: all.filter((f) => f.severity === 'warn').length,
    adSets: swept,
  }
}

/**
 * 扫全部配了广告账户的活跃客户。
 *
 * 串行不并行：Meta 对同一个 token 有速率限制，几十个客户并发打过去反而更慢
 * 且会被限流；这是个每天跑一次的后台任务，不差这几分钟。
 */
export async function sweepAllClients(
  supabase: SupabaseClient,
): Promise<ClientSweepResult[]> {
  // 候选客户集合：老列有值，或者在 client_meta_ad_accounts 里登记过账户，
  // 两边任一为真都要进来扫——只看老列会漏掉"主账户被清空但还有其他登记账户"
  // 的客户。真正的账户列表（可能不止一个）再逐客户去 client_meta_ad_accounts 查一遍。
  const clients = await getActiveClientsWithMetaAccounts(supabase)

  const results: ClientSweepResult[] = []
  for (const c of clients) {
    const accountIds = await getClientAdAccountIds(c.id)
    for (const accountId of accountIds) {
      try {
        results.push(await sweepClient({ ...c, meta_ad_account_id: accountId }))
      } catch (err) {
        // 一个客户 / 一个账户炸了不能让其余的今天都不扫。
        results.push({
          clientId: c.id,
          clientName: c.name,
          adAccountId: accountId,
          adSetsChecked: 0,
          blockers: 0,
          warns: 0,
          adSets: [],
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return results
}

/**
 * 把扫描结果压成待办能用的一句话。
 *
 * 只留 blocker：warn 每天都会有一堆，全下发给人等于没下发。
 */
export function blockerSummary(r: ClientSweepResult): string | null {
  const bad = r.adSets.filter((s) => s.hasBlocker)
  if (bad.length === 0) return null
  const lines = bad.map((s) => {
    const why = s.findings
      .filter((f) => f.severity === 'blocker')
      .map((f) => f.message)
      .join(' ')
    return `「${s.adSetName}」：${why}`
  })
  return lines.join('\n')
}
