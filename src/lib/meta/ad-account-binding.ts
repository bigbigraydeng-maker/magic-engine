/**
 * Meta 广告账户绑定的三道闸（AD-SEC-3 · 2026-09-13）。
 *
 * ── 为什么 ───────────────────────────────────────────────────────────────
 * 广告写路径的归属校验（campaign-ownership.ts）核对「campaign 所属账户 ∈ 这个
 * 客户登记的账户」。登记本身如果能被随手改，那道校验就形同虚设：把 A 客户的
 * 登记改成 B 的账户号，再拿 B 的 campaign_id 去停/改预算，令牌又常常是能看到
 * 多家账户的共享令牌（token-manager.ts 第 3 步回落）。
 *
 * ── 各道闸分别防什么（别高估 Graph 那道）──────────────────────────────
 * 1. 只有内部员工能写（在路由里，requireGlobalAdmin）—— 防客户自己改。
 * 2. 同一账户已登记在别的客户名下 → 拒绝，除非内部员工显式覆盖并写原因
 *    （findOtherClientRegistrations）—— **跨客户误绑的主防线**。
 * 3. Graph 核实（verifyAdAccountAccessible）—— **只防输错号 / 死号**。
 *    共享令牌本来就能读到多家客户的账户，「令牌读得到」≠「账户属于这个客户」，
 *    所以审计里要记 token_source，界面要把 Meta 返回的账户名给人看。
 *
 * 这里不写死任何客户或行业：只处理「一个客户 ↔ 若干 Meta 广告账户」这件事。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { GRAPH_BASE } from './client'

/** Meta 账户号的最长位数上限 —— 真实账户 15-17 位，留余量但拒绝超长垃圾输入。 */
const MAX_ACCOUNT_DIGITS = 25

/**
 * 把用户输入规整成 `act_<digits>`。空 → null（清空绑定）；格式不对 → 抛错。
 *
 *   - trim、`act_` 前缀大小写不敏感、只填数字自动补 `act_`
 *   - 至少 10 位（防 `act_0` 这类截断/测试号）
 *   - **禁止前导零**：Meta 账户号不以 0 开头；放行前导零会让 `act_0123…` 和
 *     `act_123…` 在比对时被当成两个账户，绕过重复登记检查
 */
export function parseAdAccountInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('ad_account_id must be a string or null')

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  const candidate = /^\d+$/.test(trimmed) ? `act_${trimmed}` : trimmed.toLowerCase()
  if (!new RegExp(`^act_[1-9]\\d{9,${MAX_ACCOUNT_DIGITS - 1}}$`).test(candidate)) {
    throw new Error(
      'ad_account_id must look like `act_<digits>`: 10+ digits, not starting with 0 (e.g. act_2775766642787274)',
    )
  }
  return candidate
}

/**
 * 比对用的规范形：去空白、去大小写、去 `act_`、去前导零。
 * 用于**已通过 parseAdAccountInput 或 Meta 返回**的干净值。
 */
export function canonicalAccountDigits(id: string): string {
  const compact = id.replace(/\s+/g, '').toLowerCase()
  const digits = compact.startsWith('act_') ? compact.slice(4) : compact
  return digits.replace(/^0+/, '')
}

/**
 * 登记表里存的值可能是后台手填的脏数据（全角数字、零宽字符、`act-`、多个号用
 * 逗号拼在一起…）。重复检查必须对这些**也认得出**，否则就是 fail-open：
 * NFKC 归一（全角 → 半角），去掉空白和零宽字符，再按其余非数字切段，每段去前导零，任一段等于目标即算命中。
 * （狄仁杰 2026-09-13 实测：只做 canonicalAccountDigits 时 7 种手工写法漏认。）
 */
export function registeredValueMatches(stored: string, targetDigits: string): boolean {
  return stored
    .normalize('NFKC')
    .replace(/[\s\p{Cf}]/gu, '') // whitespace / zero-width inside a number must not split it
    .split(/\D+/)
    .some(run => run.length > 0 && run.replace(/^0+/, '') === targetDigits)
}

export interface VerifiedAdAccount {
  /** 规范存储形 `act_<digits>`，来自 Meta 返回值而不是用户输入。 */
  id: string
  name: string | null
  account_status: number | null
  business_id: string | null
  business_name: string | null
}

export type AdAccountVerification =
  | { ok: true; account: VerifiedAdAccount }
  | { ok: false; kind: 'not_accessible' | 'graph_unavailable' | 'id_mismatch'; detail: string }

interface GraphAdAccount {
  id?: string
  account_id?: string
  name?: string
  account_status?: number
}

async function graphGet(path: string, fields: string, token: string): Promise<Response> {
  const params = new URLSearchParams({ fields, access_token: token })
  return fetch(`${GRAPH_BASE}/${path}?${params.toString()}`)
}

/**
 * 用这个客户的令牌读一次账户。必需字段失败 → 拒；`business` 单独读、失败不拒
 * （个人广告账户没有 Business Manager，令牌也可能缺 business_management 权限）。
 */
export async function verifyAdAccountAccessible(
  adAccountId: string,
  token: string,
): Promise<AdAccountVerification> {
  let res: Response
  try {
    res = await graphGet(adAccountId, 'id,account_id,name,account_status', token)
  } catch (err) {
    return { ok: false, kind: 'graph_unavailable', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    const kind = res.status >= 500 ? 'graph_unavailable' : 'not_accessible'
    return { ok: false, kind, detail: `HTTP ${res.status} ${body}` }
  }

  const json = (await res.json().catch(() => ({}))) as GraphAdAccount
  const returned = json.account_id ?? json.id ?? ''
  if (!returned || canonicalAccountDigits(returned) !== canonicalAccountDigits(adAccountId)) {
    return { ok: false, kind: 'id_mismatch', detail: `Meta returned account ${returned || '(none)'}` }
  }

  const business = await readBusiness(adAccountId, token)
  return {
    ok: true,
    account: {
      id: `act_${canonicalAccountDigits(returned)}`,
      name: json.name ?? null,
      account_status: typeof json.account_status === 'number' ? json.account_status : null,
      business_id: business?.id ?? null,
      business_name: business?.name ?? null,
    },
  }
}

async function readBusiness(
  adAccountId: string,
  token: string,
): Promise<{ id: string | null; name: string | null } | null> {
  try {
    const res = await graphGet(adAccountId, 'business{id,name}', token)
    if (!res.ok) return null
    const json = (await res.json()) as { business?: { id?: string; name?: string } }
    return json.business ? { id: json.business.id ?? null, name: json.business.name ?? null } : null
  } catch {
    return null
  }
}

export interface OtherClientRegistration {
  client_id: string
  client_name: string | null
}

/**
 * 这个账户（按规范形比对）是否已登记在**别的**客户名下 —— 新表和老列都查。
 * 任何一次查询出错都抛出，调用方必须 fail closed（查不出来 ≠ 没有重复）。
 *
 * 全量读出再在内存里比对：登记表不强制格式，数据库侧的等值查询会漏掉异形写法
 * （比对规则见 registeredValueMatches）。
 */
export async function findOtherClientRegistrations(
  clientId: string,
  adAccountId: string,
): Promise<OtherClientRegistration[]> {
  const target = canonicalAccountDigits(adAccountId)

  const tableRows = await fetchAll<{ client_id: string; ad_account_id: string | null }>((from, to) =>
    supabaseAdmin
      .from('client_meta_ad_accounts')
      .select('client_id, ad_account_id')
      .order('id', { ascending: true })
      .range(from, to),
  )
  const legacyRows = await fetchAll<{ id: string; name: string | null; meta_ad_account_id: string | null }>(
    (from, to) =>
      supabaseAdmin
        .from('clients')
        .select('id, name, meta_ad_account_id')
        .not('meta_ad_account_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  )

  const names = new Map(legacyRows.map(r => [r.id, r.name]))
  const hits = new Set<string>()
  for (const r of tableRows) {
    if (r.client_id !== clientId && r.ad_account_id && registeredValueMatches(r.ad_account_id, target)) {
      hits.add(r.client_id)
    }
  }
  for (const r of legacyRows) {
    if (r.id !== clientId && r.meta_ad_account_id && registeredValueMatches(r.meta_ad_account_id, target)) {
      hits.add(r.id)
    }
  }
  const unnamed = Array.from(hits).filter(id => !names.has(id))
  if (unnamed.length > 0) {
    // 只为界面显示名字；读不到名字不影响「有重复」这个结论。
    const { data } = await supabaseAdmin.from('clients').select('id, name').in('id', unnamed)
    for (const r of (data ?? []) as Array<{ id: string; name: string | null }>) names.set(r.id, r.name)
  }
  return Array.from(hits).map(id => ({ client_id: id, client_name: names.get(id) ?? null }))
}
