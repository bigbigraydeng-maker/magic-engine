/**
 * 「Facebook 主页绑定没核实」→ 下发到「需要你动手」（AD-SEC-4 · 2026-09-17）。
 *
 * 私信同步、表单线索同步、评论自动回复只在核实过属于这个客户的主页上跑
 * （src/lib/meta/page-sync-authorization.ts）。被拒的客户不下发到这里，就只剩
 * 运行记录里一行 error —— 铁律 3 下半：管道不许断头。
 *
 * 两档：
 *   · 已暂停（核实不通过）—— 私信和线索这会儿就没在进来；
 *   · 还在跑，但绑定是 2026-09-17 之前手动设的、没有核实记录 —— 点一次保存补上。
 *
 * 扫的是**所有**绑了主页的客户（同步任务也不按 client_status 过滤），不是活跃名单。
 * 本文件一行写操作都没有；读失败时生成一条「检查没跑成」的待办，而不是只打日志。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { assessConfiguredPage, assessPageBinding, type PageSyncRefusal } from '@/lib/meta/page-sync-authorization'
import { pageIdMatches } from '@/lib/meta/page-binding'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-items'

export type PageBindingItemKind = 'facebook_page_binding_unverified'

const KIND: PageBindingItemKind = 'facebook_page_binding_unverified'

/** FacebookPagePanel 只挂在客户页的设置抽屉「platform」页签里，/settings 路由里没有它。 */
function panelHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}?settings=platform`
}

const REASON_TEXT: Record<Exclude<PageSyncRefusal, 'no_meta_token'>, string> = {
  bound_to_other_client: '同一个主页还绑在别的客户名下，说不清是谁的',
  not_bound_page: '填的主页不是这个客户绑定的主页，也没有这个主页的「连接 Meta」授权',
  audit_mismatch: '现在绑的主页跟核实记录里最后一次保存的对不上（被绕过设置页改过，或上次保存没写完）',
  unverified_shared_token: '绑定是早先手动设的，没有核实记录，而这个客户只能用公用令牌读主页',
  check_failed: '核实时读数据库失败了',
}

const HOW_RESAVE =
  '点链接打开这个客户的设置抽屉，在「Facebook 主页」卡片里点「重新核实」（系统会让 Meta 核实、查重复并留记录），' +
  '核实后看卡片上显示的主页名是不是这个客户自己的，不是就清空；或者让客户在同一张卡片里点「连接 Meta」授权。'

export async function pushPageBindingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  env: Record<string, string | undefined>,
): Promise<void> {
  let rows: Array<{ id: string; name: string | null; facebook_page_id: string | null }>
  try {
    rows = await fetchAll((from, to) =>
      supabase
        .from('clients')
        .select('id, name, facebook_page_id')
        .not('facebook_page_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (err) {
    items.push({
      kind: KIND,
      client_id: '',
      client_name: '所有绑了 Facebook 主页的客户',
      what: `今天没查成哪些客户的主页绑定没核实（读客户列表失败：${err instanceof Error ? err.message : String(err)}）—— 被暂停同步的客户可能没出现在这里`,
      how: '明天这条还在就找开发看数据库连接；着急的话打开各客户设置抽屉的「Facebook 主页」卡片，看有没有「同步已暂停」字样。',
      href: `${APP_BASE}/dashboard/clients`,
    })
    return
  }

  for (const row of rows) {
    // Assess the raw column value, exactly as the syncs read it — trimming here
    // would call a binding "verified" that the sync refuses.
    const pageId = row.facebook_page_id
    if (!pageId?.trim()) continue
    const name = row.name ?? '未知客户'
    let verdict: Awaited<ReturnType<typeof assessPageBinding>>
    try {
      verdict = await assessPageBinding(supabase, row.id, pageId, env)
    } catch (err) {
      verdict = { verified: false, reason: 'check_failed', detail: err instanceof Error ? err.message : String(err) }
    }
    if (verdict.verified) {
      if (verdict.via !== 'legacy_client_token') continue
      items.push({
        kind: KIND, client_id: row.id, client_name: name,
        what: `Facebook 主页 ${pageId} 还在同步，但这个绑定没有核实记录 —— 当初是谁、凭什么绑上的查不到`,
        how: HOW_RESAVE,
        href: panelHref(row.id),
      })
      continue
    }

    const reason = verdict.reason
    // 没令牌不是绑定核实的问题，同步本来就跑不了，别处的待办负责。
    if (reason === 'no_meta_token') continue
    items.push({
      kind: KIND, client_id: row.id, client_name: name,
      what: `私信、表单线索、评论自动回复已暂停：Facebook 主页 ${pageId} 的绑定没通过核实（${REASON_TEXT[reason]}）—— 这期间客人的私信和留资不会进 CRM`,
      how: reason === 'bound_to_other_client'
        ? '先弄清这个主页到底是哪个客户的：点链接看设置抽屉里的「Facebook 主页」卡片，把不是它的那个客户的主页清空，再在对的客户那边点「重新核实」。'
        : HOW_RESAVE,
      href: panelHref(row.id),
    })
  }

  await pushCommentPageItems(supabase, items, env, new Map(rows.map((r) => [r.id, r])))
}

/**
 * 评论自动回复配的主页不是绑定主页（客户成员能改那个配置）→ 自动回复已停。
 * 配的就是绑定主页的，上面按绑定核实已经下发过，这里不重复。
 */
async function pushCommentPageItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  env: Record<string, string | undefined>,
  bound: Map<string, { id: string; name: string | null; facebook_page_id: string | null }>,
): Promise<void> {
  const { data, error } = await supabase
    .from('social_comment_config')
    .select('client_id, fb_page_id')
    .eq('enabled', true)
  if (error) {
    items.push({
      kind: KIND, client_id: '', client_name: '开了评论自动回复的客户',
      what: `今天没查成评论自动回复配的主页对不对（${error.message}）`,
      how: '明天这条还在就找开发看数据库连接。',
      href: `${APP_BASE}/dashboard/clients`,
    })
    return
  }
  for (const cfg of (data ?? []) as Array<{ client_id: string; fb_page_id: string | null }>) {
    const configured = cfg.fb_page_id?.trim()
    if (!configured) continue
    const boundPage = bound.get(cfg.client_id)?.facebook_page_id?.trim()
    if (boundPage && pageIdMatches(boundPage, configured)) continue
    const verdict = await assessConfiguredPage(supabase, cfg.client_id, configured, env)
    if (verdict.verified || verdict.reason === 'no_meta_token') continue
    items.push({
      kind: KIND,
      client_id: cfg.client_id,
      client_name: bound.get(cfg.client_id)?.name ?? '未知客户',
      what: `评论自动回复已停：配置里填的主页 ${configured} 不是这个客户已核实的 Facebook 主页（${REASON_TEXT[verdict.reason]}）—— 这个主页上的评论没人自动回`,
      how: '点链接打开设置抽屉：如果填错了，把评论自动回复里的主页 ID 改成「Facebook 主页」卡片里绑定的那个；如果确实要回另一个主页，让客户用那个主页的管理员账号点「连接 Meta」授权。',
      href: panelHref(cfg.client_id),
    })
  }
}
