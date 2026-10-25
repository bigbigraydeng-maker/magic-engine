/**
 * Round-robin lead assignee picker.
 *
 * 用在哪：`meta-lead.ts` 新建 contact 时调一次，拿到该跟进人的登录邮箱
 * 填到 `contacts.assigned_to`。将来对外表单、WhatsApp 新客人也走同一个库。
 *
 * 怎么 round-robin：
 *   - 从 `client_portal_users` 查这个客户下所有 `receives_round_robin_leads=true`
 *     的行，按 email 字典序排。
 *   - 查 `contacts` 里这个客户当前每个人持有多少未完成线索（任意状态都算）；
 *     选持有数最少的那个；并列时按 email 字典序取第一个。
 *   - N=1 时退化成「全给他」，不用改代码。
 *
 * 为什么不用「最近一次谁被分」做游标：
 *   - 要存游标 = 要新表 / 新列；选「谁手头线索最少」等价结果，但只读 contacts
 *     就能算，部署和回滚都轻。
 *   - 真实场景里 Baker 请假、Lisa 一个人顶班的那段时间，这个算法会自动把新
 *     线索更多给 Lisa（因为 Baker 的持有数不增），而严格 round-robin 会机械
 *     地来回切，把线索扔给请假的人。
 *
 * 空名单时返回 null —— 调用方照旧写入 contact（assigned_to 保持 null，不阻塞
 * 入库）。配上「我的待跟进」看板的「未分配」桶兜底。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface AssigneeRow {
  email: string
}

export interface PickAssigneeOptions {
  clientId: string
  /** 可注入 supabase 以便单测。 */
  supabase: Pick<SupabaseClient, 'from'>
}

/**
 * 查这个客户下谁接 round-robin 线索。
 * 导出单独便于单测、看板读、将来扩成「每人持有数」展示。
 */
export async function listAssignees(opts: PickAssigneeOptions): Promise<AssigneeRow[]> {
  const { data, error } = await opts.supabase
    .from('client_portal_users')
    .select('email')
    .eq('client_id', opts.clientId)
    .eq('receives_round_robin_leads', true)
    .order('email', { ascending: true })

  if (error) throw new Error(`listAssignees: ${error.message}`)
  return (data ?? []) as AssigneeRow[]
}

/**
 * 查每个候选人当前持有多少线索。返回 Map<email, count>。
 * 没有行的候选人以 0 返回（Supabase 的 count-group-by 用 head:true 省流量）。
 */
export async function countHeldLeads(
  opts: PickAssigneeOptions,
  emails: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const email of emails) counts.set(email, 0)
  if (emails.length === 0) return counts

  // 一次性查该客户下 assigned_to 命中候选名单的 contacts，group by 邮箱。
  // Supabase JS 不直接支持 GROUP BY，这里用 select + 客户端聚合；候选名单
  // 通常只有 2–5 人，contacts 行数也可控。真要撑规模再换 RPC。
  const { data, error } = await opts.supabase
    .from('contacts')
    .select('assigned_to')
    .eq('client_id', opts.clientId)
    .in('assigned_to', emails)

  if (error) throw new Error(`countHeldLeads: ${error.message}`)
  for (const row of (data ?? []) as Array<{ assigned_to: string | null }>) {
    if (!row.assigned_to) continue
    counts.set(row.assigned_to, (counts.get(row.assigned_to) ?? 0) + 1)
  }
  return counts
}

/**
 * 挑一个跟进人。候选为空返回 null。
 */
export async function pickAssignee(opts: PickAssigneeOptions): Promise<string | null> {
  const assignees = await listAssignees(opts)
  if (assignees.length === 0) return null
  if (assignees.length === 1) return assignees[0].email

  const emails = assignees.map((a) => a.email)
  const counts = await countHeldLeads(opts, emails)

  // 持有数升序 + 字典序升序 (listAssignees 已字典序，稳定排序保留它)。
  const sorted = [...emails].sort((a, b) => {
    const ca = counts.get(a) ?? 0
    const cb = counts.get(b) ?? 0
    if (ca !== cb) return ca - cb
    return a < b ? -1 : a > b ? 1 : 0
  })
  return sorted[0]
}
