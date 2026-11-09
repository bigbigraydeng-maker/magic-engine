/**
 * 「这个客户的 Mailchimp audience id 是多少」—— 全仓唯一入口。
 *
 * ⚠️ **不要直接 `select('mailchimp_audience_id')`。**
 *
 * 那一列由 `supabase/migrations/20260826010000_mailchimp_audience_id.sql` 定义，
 * 但那条 migration **至今没有应用到生产**（文件头写明 Issue #1188 要求
 * `migration_applied = false`）。直接选它，整条 PostgREST 查询会 400：
 *
 *   {"code":"42703","message":"column clients.mailchimp_audience_id does not exist"}
 *
 * 这不是推测 —— 2026-09-02 与 2026-09-03 两次对生产库（`glbdnayojixmexgofbsd`）
 * 实测都是这个结果。后果是 `crm/meta-lead.ts` 的 Mailchimp 出口每小时都走
 * 「读配置失败」分支静默 skip，Meta 表单进来的人**从来没有**被同步进 audience，
 * Mailchimp 里也从来没出现过 `facebook_leadgen` 标签。
 *
 * 所以这里的读法是：
 *   1. 先探专列（apply 之后自动优先用它，将来不用回来改代码）；
 *   2. **只有 42703「这一列不存在」这一种错**才降级 —— 权限被回收、网络抖动、
 *      schema cache 没刷新都必须如实报错，不许一起吞掉（本仓反复吃过的
 *      「空有三种来路」）；
 *   3. 落脚 `clients.leads_config`（jsonb，一定存在）里的 `mailchimp_audience_id`。
 *
 * 平台边界：这里只读 provider 配置，不含任何客户名 / 行业判断。CTS 的具体
 * audience id 存在数据库的 `leads_config` 里，不在代码里。
 */

import { supabaseAdmin } from '@/lib/supabase'

/** PostgREST 的 undefined_column。只有这一种错该被当成「专列还没 apply」。 */
export function isUndefinedColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === '42703' || /does not exist/i.test(err.message ?? '')
}

/** `clients.leads_config.mailchimp_audience_id` —— 专列没 apply 时的落脚点。 */
export function audienceFromLeadsConfig(leadsConfig: unknown): string {
  const cfg = (leadsConfig ?? {}) as { mailchimp_audience_id?: unknown }
  return typeof cfg.mailchimp_audience_id === 'string' ? cfg.mailchimp_audience_id.trim() : ''
}

export type AudienceIdRead =
  /** 读到了配置。`audienceId` 为空串 = 这个客户明确没配（出口关闭，零 provider 调用）。 */
  | { ok: true; audienceId: string }
  /** 真的读不到 —— 不是「没配」。上游必须如实上报，不许当成「没有」。 */
  | { ok: false; message: string }

interface ClientAudienceRow {
  leads_config?: unknown
  mailchimp_audience_id?: unknown
}

/**
 * 专列查询**成功**时取值：只信专列，哪怕是空串。
 *
 * 空串在这里必须是权威结果 —— 运营就是靠把 `clients.mailchimp_audience_id`
 * 设成 `NULL` / 空串来关闭这个客户的 Mailchimp 出口。如果专列已经能查到，还
 * 倒回去读旧 `leads_config`，关闭出口的操作会被旧配置悄悄盖回去，本该停止
 * 的订阅继续发生 —— 一个「关不掉的开关」比读不到配置更糟。旧 `leads_config`
 * 只在专列**不存在**（42703，见下）时才有资格兜底。
 *
 * ⚠️ **apply 那条 migration 之前，必须先把 `leads_config` 里配过的 audience id
 * 搬进专列**：专列一出现（除 CTS 由 migration 自己种下之外全是 NULL），那些客户
 * 的出口会当场静默关闭。2026-09-03 实测全库只有 CTS 一家配过。
 */
function pickDedicatedAudienceId(row: ClientAudienceRow | null): string {
  return typeof row?.mailchimp_audience_id === 'string' ? row.mailchimp_audience_id.trim() : ''
}

/**
 * 单个客户的 audience id。
 *
 * 客户行不存在时返回 `{ ok: true, audienceId: '' }` —— 「查得到、就是没配」，
 * 跟「查不到」是两件事，上游的 skip 理由不一样。
 */
export async function readAudienceId(clientId: string): Promise<AudienceIdRead> {
  const withDedicated = await supabaseAdmin
    .from('clients')
    .select('mailchimp_audience_id')
    .eq('id', clientId)
    .maybeSingle()

  if (!withDedicated.error) {
    // 专列查得到就是权威结果，不再兜底 leads_config —— 空串代表运营已明确关闭出口。
    return {
      ok: true,
      audienceId: pickDedicatedAudienceId(withDedicated.data as ClientAudienceRow | null),
    }
  }
  if (!isUndefinedColumn(withDedicated.error)) {
    return { ok: false, message: withDedicated.error.message }
  }

  // 专列还没 apply（42703）—— 这时才有资格退到只读 jsonb。这一次再失败就是真失败。
  const fallback = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (fallback.error) {
    return { ok: false, message: fallback.error.message }
  }
  return {
    ok: true,
    audienceId: audienceFromLeadsConfig((fallback.data as ClientAudienceRow | null)?.leads_config),
  }
}

// ── 来源标签 ─────────────────────────────────────────────────────────────────

/**
 * 没配就用这个。**加**标签不具破坏性，所以给默认值是安全的 —— 跟
 * `lead_tags_to_remove`「绝不给默认」的理由正相反：摘错标签会让人从名单里消失，
 * 加一个标签最多是多一个没人用的分组。
 */
export const DEFAULT_META_LEAD_SOURCE_TAG = 'facebook_leadgen'

/**
 * Meta 广告线索进 Mailchimp 时打的来源标签名，从客户配置读。
 *
 * **为什么不能写死在共享代码里**：标签名是每家客户自己 Mailchimp 里长出来的，
 * 不是平台规则（平台化红线 2，跟 `mailchimp-paid-tagging` 的 `paid_tag` 同一条
 * 规矩）。CTS 用的是 `fb_lead`（名单里 33 人，2026-09-06 PM 拍板沿用），换成
 * Oztop 或地产客户就会是别的名字。
 *
 * 读不到配置时**不猜**：返回 `ok:false` 让上游如实上报，不拿默认值把「读失败」
 * 伪装成「客户就是要默认」—— 这条链路上个月刚因为分不清这两者静默跑空一整月。
 */
export async function readLeadSourceTag(
  clientId: string,
): Promise<{ ok: true; tag: string } | { ok: false; message: string }> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error) return { ok: false, message: error.message }

  const cfg = (data?.leads_config ?? {}) as { meta_leads?: { source_tag?: unknown } }
  const raw = cfg.meta_leads?.source_tag
  const tag = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_META_LEAD_SOURCE_TAG
  return { ok: true, tag }
}

// ── 写 ──────────────────────────────────────────────────────────────────────

/**
 * 改一个客户的 audience id —— 写到 `readAudienceId` **正在读的那个地方**。
 *
 * 必须跟读一一对称，否则会出现最难查的一种坏法：界面显示保存成功，出口却仍然
 * 读旧值。今天专列还没 apply，值在 `leads_config` 里；专列一旦 apply，读那边就
 * 只认专列，写也必须跟着搬过去 —— 靠人记得改代码是靠不住的，所以这里跟读用同
 * 一套探测（42703 = 专列不存在）。
 *
 * 空字符串是**合法输入**，语义是「关掉这个客户的出口」（专列写 NULL）。
 */
export async function writeAudienceId(
  clientId: string,
  audienceId: string,
): Promise<{ ok: true; storedIn: 'column' | 'leads_config' } | { ok: false; message: string }> {
  const value = audienceId.trim()

  // 先试专列。列不存在时 PostgREST 整条 42703，不是「写了个寂寞」。
  const direct = await supabaseAdmin
    .from('clients')
    .update({ mailchimp_audience_id: value || null })
    .eq('id', clientId)

  if (!direct.error) return { ok: true, storedIn: 'column' }
  if (!isUndefinedColumn(direct.error)) return { ok: false, message: direct.error.message }

  // 专列还没 apply —— 落回 jsonb。**读-改-写**：leads_config 里还有域名规则、
  // 通知邮箱、付费打标策略，整块覆盖会把它们全抹掉。
  const cur = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()
  if (cur.error) return { ok: false, message: cur.error.message }

  const next = {
    ...((cur.data?.leads_config as Record<string, unknown> | null) ?? {}),
    mailchimp_audience_id: value,
  }
  const upd = await supabaseAdmin.from('clients').update({ leads_config: next }).eq('id', clientId)
  if (upd.error) return { ok: false, message: upd.error.message }

  return { ok: true, storedIn: 'leads_config' }
}
