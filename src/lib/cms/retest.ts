/**
 * 把标成「坏了」的发布通道自动重测一遍。
 *
 * 🔴 为什么必须有（2026-08-05 实测事故）：
 *
 *    Oztop 的 WordPress 通道在 **2026-06-19** 被标成 error，原文是：
 *      「response is not JSON — the site may be blocking REST API access…
 *        /.well-known/sgcaptcha/?r=%2Fwp-json%2F…」
 *    也就是客户主机商的安全防护把我们的服务器当成机器人，返了一个验证码页。
 *
 *    **那天正好是最后一篇文章成功上线的日子。** 之后 47 天里，
 *    没有任何东西重测过这条连接 —— 全仓没有一个 cron 碰 `cms_connections`，
 *    只有人手动点「测试连接」才会重测。
 *
 *    于是：一次很可能只持续几分钟的临时拦截 = **永久停止发布**。
 *    与此同时周更 cron 每周照常写文章，写完全部沉在库里没人看见。
 *
 * 所以这个模块只做一件事：**让临时故障能自己好**。
 * 它只碰 `status='error'` 的行 —— 不去动正常的连接，
 * 因为把一条好连接因为一次网络抖动翻成 error，正是上面那场事故的成因。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { judgeDomainOwnership } from '@/lib/clients/domain-match'

/**
 * 通道指向的是不是这个客户自己的站。
 *
 * 🔴 判断逻辑**不在这里** —— 全仓唯一一份在 `@/lib/clients/domain-match`。
 *    先前这里有一份副本，写完当天就跟另一份漂移了（一份剥 `sc-domain:` 一份不剥，
 *    而生产的 GSC 记录正是那个形状），同一行记录两边给出相反结论。
 */
export function targetBelongsToClient(
  siteUrl: string | null | undefined,
  clientDomain: string | null | undefined,
): boolean | null {
  const v = judgeDomainOwnership(siteUrl, clientDomain)
  return v === 'unknown' ? null : v === 'owned'
}


/** 同一条连接最短重测间隔。太密等于替客户的防火墙加深对我们的敌意。 */
export const RETEST_MIN_HOURS = 20

export interface RetestCandidateRow {
  client_id: string
  provider: string
  status: string
  last_tested_at: string | null
  /** 通道指向的站点（WordPress/Shopify 才有；GitHub 是仓库，没有这个） */
  site_url?: string | null
  /** 这个客户自己的域名，用来核对通道有没有指错人家 */
  client_domain?: string | null
}

export interface RetestOutcome {
  client_id: string
  provider: string
  ok: boolean
  /** 失败时的原因原文；成功时为 null */
  error: string | null
  /** 通道指向别的客户 —— 没有测，也绝不会被标成连通 */
  mismatched?: true
}

/**
 * 哪些该测。只有「坏了」的才测，而且离上次测够久了才测。
 *
 * `last_tested_at` 为空视为该测 —— 从没测过的坏连接更需要一次机会。
 */
export function pickConnectionsToRetest(
  rows: readonly RetestCandidateRow[],
  now: Date,
): RetestCandidateRow[] {
  const cutoff = now.getTime() - RETEST_MIN_HOURS * 3_600_000
  return rows.filter((r) => {
    if (r.status !== 'error') return false
    if (!r.last_tested_at) return true
    return new Date(r.last_tested_at).getTime() <= cutoff
  })
}

/** 说人话：这次失败属于哪一类，人该做什么。给待办和日志共用。 */
export function classifyFailure(error: string | null | undefined): string {
  const e = (error ?? '').toLowerCase()
  if (e.includes('不是该客户自己的网站')) {
    return '⚠️ 这条通道填的是别的客户的网站，配错了，必须先纠正（在纠正前系统不会碰它）'
  }
  if (e.includes('captcha') || e.includes('not json') || e.includes('blocking rest api')) {
    return '客户网站的安全防护把我们挡在外面了（不是密码问题）'
  }
  if (e.includes('401') || e.includes('403') || e.includes('unauthorized') || e.includes('forbidden')) {
    return '密码或权限失效了，需要重新授权'
  }
  if (e.includes('no publish role')) {
    return '这个账号在客户网站上没有发布权限'
  }
  if (e.includes('enotfound') || e.includes('timeout') || e.includes('econnrefused')) {
    return '连不上客户网站（域名或服务器的问题）'
  }
  return '连接测试没通过'
}

export interface RetestDeps {
  /** 按 provider 分发到对应的测试实现。失败要返回原因而不是抛。 */
  testConnection(clientId: string, provider: string): Promise<{ ok: boolean; error?: string }>
  /** 把结果写回连接状态。 */
  markTested(clientId: string, provider: string, ok: boolean, error?: string): Promise<void>
}

/**
 * 跑一轮重测。
 *
 * 单条失败不影响其他条：一个客户的网站挂了，不该连累别人的重测。
 */
export async function retestBrokenConnections(
  supabase: SupabaseClient,
  deps: RetestDeps,
  now: Date,
): Promise<{ checked: number; recovered: number; stillBroken: number; outcomes: RetestOutcome[] }> {
  const { data, error } = await supabase
    .from('cms_connections')
    .select('client_id, provider, status, last_tested_at, site_url, clients(domain)')
    .eq('status', 'error')

  // 查不出来就报错退出 —— 「没有坏连接」和「没查到」必须分开，
  // 后者伪装成前者会让这个 cron 看起来天天正常跑完。
  if (error) {
    throw new Error(`cms_connections 查询失败: ${error.message}`)
  }

  // PostgREST 的嵌套 select 可能返回对象也可能返回单元素数组，两种都接住
  const rows = ((data ?? []) as unknown as Array<
    RetestCandidateRow & { clients?: { domain: string | null } | Array<{ domain: string | null }> | null }
  >).map((r) => {
    const joined = Array.isArray(r.clients) ? r.clients[0] : r.clients
    return { ...r, client_domain: r.client_domain ?? joined?.domain ?? null }
  })

  const due = pickConnectionsToRetest(rows, now)
  const outcomes: RetestOutcome[] = []

  for (const row of due) {
    // 🔴 先核对指向。指错客户的通道**连测都不测** —— 测通了就会被标成连通，
    //    而那正是把「一直沉睡的填错」变成「客户内容串台」的那一步。
    if (targetBelongsToClient(row.site_url, row.client_domain) === false) {
      console.warn(
        `[cms-retest] ${row.client_id}/${row.provider} 指向 ${row.site_url}，` +
          `不是该客户的域名（${row.client_domain}）—— 跳过，不测也不标连通`,
      )
      outcomes.push({
        client_id: row.client_id,
        provider: row.provider,
        ok: false,
        error: `这条通道指向 ${row.site_url}，不是该客户自己的网站（${row.client_domain}）`,
        mismatched: true,
      })
      continue
    }

    try {
      const res = await deps.testConnection(row.client_id, row.provider)
      await deps.markTested(row.client_id, row.provider, res.ok, res.error)
      outcomes.push({
        client_id: row.client_id,
        provider: row.provider,
        ok: res.ok,
        error: res.ok ? null : (res.error ?? '未知原因'),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[cms-retest] ${row.client_id}/${row.provider} 重测本身出错:`, msg)
      outcomes.push({ client_id: row.client_id, provider: row.provider, ok: false, error: msg })
    }
  }

  return {
    checked: outcomes.length,
    recovered: outcomes.filter((o) => o.ok).length,
    stillBroken: outcomes.filter((o) => !o.ok).length,
    outcomes,
  }
}
