/**
 * 客户之间的东西有没有串。
 *
 * 🔴 PM 2026-08-05：「这是非常严重的问题，必须彻底修复。客户之间的信息坚决不能胡窜。」
 *
 * 起因是实测查到 **CTS（ctstours.co.nz）的 WordPress 发布通道指向
 * oztopbuildingsupplies.com.au** —— 另一个客户的网站。填错于 05-25，
 * 正确的那条 06-05 才补上，错的没人清理，**两个多月没人发现**。
 *
 * 而这类事以前就发生过（GA4 的统计账号也曾经存到错的客户名下）。
 * 所以光修那一条不算修好 —— 必须有人每天替我们看着。
 *
 * 两种查法覆盖两类串台：
 *   ① **域名对不上自己**：这条记录说的网站，不是这个客户的网站
 *   ② **同一个外部账号挂在两个客户名下**：域名比不了的（广告账户 / 主页 / 统计账号）
 *      只能靠「一个标识不该属于两家」来发现
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { judgeDomainOwnership } from './domain-match'

/** 我们自己的登录邮箱：一人管多家，共用是正常的。 */
const OUR_OWN_LOGINS = ['bigbigraydeng@gmail.com'] as const

export interface CrossClientFinding {
  /** 哪张表的哪一列 */
  source: string
  /** 涉及的客户名（串台时会有两个及以上） */
  clients: string[]
  /** 存着的那个值 */
  value: string
  /** 说人话：这是什么问题 */
  what: string
  severity: 'critical' | 'warning'
}

export interface OwnedIdentifierRow {
  client_id: string
  value: string | null
}

/**
 * ① 指向的网站不是这个客户自己的。
 *
 * **只用于「本该是客户自己资产」的字段** —— 竞品域名、SERP 结果链接、
 * 图床地址这些天生就该是别人的，拿这把尺子量会满屏误报，
 * 而「误报成常态告警就废了」。
 */
export function findDomainMismatches(
  source: string,
  rows: readonly OwnedIdentifierRow[],
  domainOf: (clientId: string) => string | null,
  nameOf: (clientId: string) => string,
): CrossClientFinding[] {
  const seen = new Set<string>()
  const out: CrossClientFinding[] = []
  for (const r of rows) {
    if (!r.value) continue
    const verdict = judgeDomainOwnership(r.value, domainOf(r.client_id))
    if (verdict === 'owned') continue

    const key = `${r.client_id}|${r.value}|${verdict}`
    if (seen.has(key)) continue
    seen.add(key)

    if (verdict === 'foreign') {
      out.push({
        source,
        clients: [nameOf(r.client_id)],
        value: r.value,
        what: `${nameOf(r.client_id)} 名下存着 ${r.value}，但这不是该客户自己的网站（${domainOf(r.client_id) ?? '未填域名'}）`,
        severity: 'critical',
      })
      continue
    }

    // 🔴 「判断不了」**不等于安全**。客户没填自己的域名（生产里真有 2 个），
    //    或域名填成了公共后缀 —— 这时闸门放行、排查沉默，那个客户完全不设防。
    //    必须把这件事本身报出来，而不是当成没问题。
    out.push({
      source,
      clients: [nameOf(r.client_id)],
      value: r.value,
      what: `${nameOf(r.client_id)} 有对外通道（${r.value}），但没法核对它是不是该客户自己的 —— 客户档案里的域名是「${domainOf(r.client_id) ?? '空'}」。**这个客户的串台检查目前是关闭的**`,
      severity: 'warning',
    })
  }
  return out
}

/**
 * ② 同一个外部账号挂在两个及以上客户名下。
 *
 * ⚠️ 不是所有共用都算错：**我们自己的登录账号**（一个人管好几家的站长工具）
 * 天生就该共用。所以调用方要传 `ignore`，把这类已知合法的共用排除掉，
 * 否则这条会变成天天响的噪音。
 */
export function findSharedIdentifiers(
  source: string,
  rows: readonly OwnedIdentifierRow[],
  nameOf: (clientId: string) => string,
  opts: { ignore?: readonly string[]; severity?: 'critical' | 'warning'; what?: (v: string, names: string[]) => string } = {},
): CrossClientFinding[] {
  const ignore = new Set((opts.ignore ?? []).map((s) => s.toLowerCase()))
  const byValue = new Map<string, Set<string>>()

  for (const r of rows) {
    if (!r.value) continue
    const v = r.value.trim()
    if (!v || ignore.has(v.toLowerCase())) continue
    const set = byValue.get(v) ?? new Set<string>()
    set.add(r.client_id)
    byValue.set(v, set)
  }

  const out: CrossClientFinding[] = []
  for (const [value, clientIds] of Array.from(byValue.entries())) {
    if (clientIds.size < 2) continue
    const names = Array.from(clientIds).map((id) => nameOf(id)).sort()
    out.push({
      source,
      clients: names,
      value,
      what:
        opts.what?.(value, names) ??
        `${value} 同时挂在 ${names.join(' 和 ')} 名下 —— 一个客户的账号不该属于两家`,
      severity: opts.severity ?? 'critical',
    })
  }
  return out
}

/** 一次跑完所有检查。任一查询失败都抛 —— 「查不到」不能当成「没问题」。 */
export async function auditCrossClientLeaks(
  supabase: SupabaseClient,
): Promise<CrossClientFinding[]> {
  const clientsRes = await supabase.from('clients').select('id, name, domain')
  if (clientsRes.error) throw new Error(`clients 查询失败: ${clientsRes.error.message}`)

  const clients = (clientsRes.data ?? []) as Array<{ id: string; name: string; domain: string | null }>
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? id
  const domainOf = (id: string) => clients.find((c) => c.id === id)?.domain ?? null
  // 我们自己的登录邮箱 —— 一个人管多家客户的站长工具/邮箱，是正常共用，不是串台。
  // （这里原来写成一个恒真的三元表达式，看着像跟客户表有关，其实就是个常量。）

  const findings: CrossClientFinding[] = []

  const cms = await supabase.from('cms_connections').select('client_id, site_url')
  if (cms.error) throw new Error(`cms_connections 查询失败: ${cms.error.message}`)
  const cmsRows = ((cms.data ?? []) as Array<{ client_id: string; site_url: string | null }>).map((r) => ({
    client_id: r.client_id,
    value: r.site_url,
  }))
  findings.push(...findDomainMismatches('发布通道（cms_connections.site_url）', cmsRows, domainOf, nameOf))
  findings.push(
    ...findSharedIdentifiers('发布通道（cms_connections.site_url）', cmsRows, nameOf, {
      what: (v, names) => `${names.join(' 和 ')} 的发布通道指向同一个网站 ${v} —— 文章会发到别人家`,
    }),
  )

  // 🔴 GitHub 通道的 site_url 是 NULL，域名尺子量不了 —— 它对上面两条检查是双盲的。
  //    而 CTS 真正在用的、天天在发的，正是 GitHub 这条。
  //    比不了域名没关系，「同一个代码仓挂在两个客户名下」是能比的。
  const repo = await supabase.from('cms_connections').select('client_id, repo_owner, repo_name')
  if (repo.error) throw new Error(`cms_connections(repo) 查询失败: ${repo.error.message}`)
  findings.push(
    ...findSharedIdentifiers(
      '代码仓通道（cms_connections.repo_owner/repo_name）',
      ((repo.data ?? []) as Array<{ client_id: string; repo_owner: string | null; repo_name: string | null }>)
        .filter((r) => r.repo_owner && r.repo_name)
        .map((r) => ({ client_id: r.client_id, value: `${r.repo_owner}/${r.repo_name}` })),
      nameOf,
      {
        what: (v, names) =>
          `${names.join(' 和 ')} 的代码仓通道都指向 ${v} —— 文章会发到别人家的网站源码里`,
      },
    ),
  )

  const oauth = await supabase.from('platform_oauth_connections').select('client_id, provider, account_id')
  if (oauth.error) throw new Error(`platform_oauth_connections 查询失败: ${oauth.error.message}`)
  findings.push(
    ...findSharedIdentifiers(
      '平台授权（platform_oauth_connections.account_id）',
      ((oauth.data ?? []) as Array<{ client_id: string; account_id: string | null }>).map((r) => ({
        client_id: r.client_id,
        value: r.account_id,
      })),
      nameOf,
      { ignore: OUR_OWN_LOGINS },
    ),
  )

  const ads = await supabase.from('meta_ads_snapshots').select('client_id, ad_account_id')
  if (ads.error) throw new Error(`meta_ads_snapshots 查询失败: ${ads.error.message}`)
  findings.push(
    ...findSharedIdentifiers(
      '广告账户（meta_ads_snapshots.ad_account_id）',
      ((ads.data ?? []) as Array<{ client_id: string; ad_account_id: string | null }>).map((r) => ({
        client_id: r.client_id,
        value: r.ad_account_id,
      })),
      nameOf,
      {
        // 同一个广告账户服务多个客户在 Type B（楼盘）模式下是设计如此，
        // 但花费会被重复归因，所以报成 warning 让人确认，而不是当泄露拦下来
        severity: 'warning',
        what: (v, names) =>
          `${names.join(' 和 ')} 共用广告账户 ${v} —— 不是泄露，但同一笔花费可能被算进两个客户的成本里，需要确认归因口径`,
      },
    ),
  )

  return findings
}
