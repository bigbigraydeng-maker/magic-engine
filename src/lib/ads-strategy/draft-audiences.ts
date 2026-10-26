/**
 * 草案受众的建前核对与账本记录（从 draft-and-gate.ts 拆出，纯搬运，行为不变）。
 * 失败关闭：读不到 / 读不全受众列表就不建；排除名单失效 = 已付款老客人仍会看到广告，所以一并核状态。
 */
import type { AdDraft } from './ad-draft'
import { MIN_INCLUDED_AUDIENCE_SIZE } from './ad-draft'
import { fetchCustomAudiences, fetchCustomAudienceById, type GraphCustomAudience } from '@/lib/meta/entity-settings'

/** 一个受众在建前核对时读到的事实；null = 没读到。 */
export interface AudienceFact {
  id: string
  name: string | null
  operationStatusCode: number | null
  deliveryStatusCode: number | null
  /** 人数下限；Meta 对小受众用 -1 / 0 表示"不报"，那种一律记成 null（读不到）。只有 >0 才是读到。 */
  countLowerBound: number | null
}

export interface AudiencesChecked {
  outcome: 'passed' | 'failed'
  reason: string | null
  included: AudienceFact[]
  excluded: AudienceFact[]
  /** 失败时带账户里读到的受众摘要（最多 50 条），方便人对照。 */
  listed?: { id: string; name: string | null }[]
}

/**
 * 草案挂了受众 → 建之前核对：这些受众真的属于这个广告账户、包含的受众准备好了且够大、
 * 排除的受众真的在排除人。
 *
 * 与最低日预算相反，这里是**失败关闭**：读不到受众列表就不建 —— 受众挂错账户，
 * Meta 要么拒收要么（更糟）静默忽略，我们没办法事后分辨。
 *
 * 排除名单尤其不能放行：排除名单不可用 = 已付款的老客人仍会看到广告。
 * 所以排除名单读不到状态和人数时也拒建；但人数小（哪怕 5 人）只要状态正常就放行。
 * 草案没有任何受众 id → 不发请求，直接过。
 */
export async function checkAudiences(
  draft: AdDraft,
  deps: { adAccountId: string; accessToken: string },
): Promise<{ error: string | null; checked: AudiencesChecked | null }> {
  const included = draft.audienceIds ?? []
  const excluded = draft.excludedAudienceIds ?? []
  if (included.length === 0 && excluded.length === 0) return { error: null, checked: null }

  const read = await readAudienceList(deps)
  if (!read.ok) return { error: read.error, checked: read.checked }

  const byId = new Map(read.rows.map((a) => [a.id, a]))
  // 账户受众列表边会漏掉部分相似受众：列表里没有的，按 id 直接读一次，所属账户号对得上就算本账户的。
  for (const id of [...included, ...excluded].filter((x) => !byId.has(x))) {
    const row = await ownedAudienceById(id, deps)
    if (row) byId.set(id, row)
  }
  const missing = [...included, ...excluded].filter((id) => !byId.has(id))
  if (missing.length > 0) {
    const error = `受众 ${missing.join('、')} 不属于这个广告账户，所以没建`
    return { error, checked: failedChecked(error, included, excluded, byId, read.listed) }
  }

  const includedFacts = included.map((id) => toFact(byId.get(id) as GraphCustomAudience))
  const excludedFacts = excluded.map((id) => toFact(byId.get(id) as GraphCustomAudience))

  for (const f of includedFacts) {
    const error = includedAudienceError(f)
    if (error) return { error, checked: failedChecked(error, included, excluded, byId, read.listed) }
  }
  for (const f of excludedFacts) {
    const error = excludedAudienceError(f)
    if (error) return { error, checked: failedChecked(error, included, excluded, byId, read.listed) }
  }
  return {
    error: null,
    checked: { outcome: 'passed', reason: null, included: includedFacts, excluded: excludedFacts },
  }
}

/** 列表里没有的受众：按 id 直读，且它所属账户号等于本账户才算（读不到 / 属于别的账户 → null，失败关闭）。 */
async function ownedAudienceById(
  id: string,
  deps: { adAccountId: string; accessToken: string },
): Promise<GraphCustomAudience | null> {
  const res = await fetchCustomAudienceById(id, deps.accessToken)
  if (!res.complete || res.error || res.rows.length === 0) return null
  const row = res.rows[0]
  const owner = typeof row.account_id === 'string' ? row.account_id.replace(/^act_/, '') : null
  if (!isAudienceRow(row) || owner === null || owner !== deps.adAccountId.replace(/^act_/, '')) return null
  return row
}

type AudienceListRead =
  | { ok: true; rows: GraphCustomAudience[]; listed: { id: string; name: string | null }[] }
  | { ok: false; error: string; checked: AudiencesChecked }

/** 读账户受众列表；读不全 / 读不懂一律失败关闭。 */
async function readAudienceList(deps: { adAccountId: string; accessToken: string }): Promise<AudienceListRead> {
  const res = await fetchCustomAudiences(deps.adAccountId, deps.accessToken)
  if (!res.complete && res.rows.length === 0 && res.error) {
    const detail = `${res.error.status} ${res.error.message}`.slice(0, 200)
    const error = `读受众列表时 Meta 拒绝或出错（${detail}），核实不了受众归属，所以没建`
    return { ok: false, error, checked: failedChecked(error, [], [], new Map(), []) }
  }
  if (!res.complete) {
    const error = '这个账户受众太多，读不全，核实不了归属，所以没建'
    return { ok: false, error, checked: failedChecked(error, [], [], new Map(), listRows(res.rows)) }
  }
  const bad = res.rows.some((r) => !isAudienceRow(r))
  if (bad) {
    const error = 'Meta 返回的受众列表格式读不懂，所以没建'
    return { ok: false, error, checked: failedChecked(error, [], [], new Map(), listRows(res.rows)) }
  }
  return { ok: true, rows: res.rows, listed: listRows(res.rows) }
}

function isAudienceRow(r: unknown): r is GraphCustomAudience {
  if (typeof r !== 'object' || r === null) return false
  const id = (r as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0
}

/** 账户里读到的受众摘要，最多 50 条。 */
function listRows(rows: readonly unknown[]): { id: string; name: string | null }[] {
  return rows
    .filter(isAudienceRow)
    .slice(0, 50)
    .map((a) => ({ id: a.id, name: typeof a.name === 'string' ? a.name : null }))
}

function failedChecked(
  error: string,
  included: readonly string[],
  excluded: readonly string[],
  byId: Map<string, GraphCustomAudience>,
  listed: { id: string; name: string | null }[],
): AudiencesChecked {
  const facts = (ids: readonly string[]) =>
    ids.filter((id) => byId.has(id)).map((id) => toFact(byId.get(id) as GraphCustomAudience))
  return {
    outcome: 'failed',
    reason: error,
    included: facts(included),
    excluded: facts(excluded),
    ...(listed.length > 0 ? { listed } : {}),
  }
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function toFact(a: GraphCustomAudience): AudienceFact {
  const count = finiteOrNull(a.approximate_count_lower_bound)
  return {
    id: a.id,
    name: typeof a.name === 'string' ? a.name : null,
    operationStatusCode: finiteOrNull(a.operation_status?.code),
    deliveryStatusCode: finiteOrNull(a.delivery_status?.code),
    countLowerBound: count !== null && count > 0 ? count : null,
  }
}

/** 包含受众：状态、投放状态、人数三道；人数读不到不拦（Meta 兜底），只记下来。 */
function includedAudienceError(f: AudienceFact): string | null {
  if (f.operationStatusCode !== null && f.operationStatusCode !== 200) {
    return `受众 ${f.id} 还没准备好（状态 ${f.operationStatusCode}），现在投不出去，所以没建`
  }
  if (f.deliveryStatusCode !== null && f.deliveryStatusCode !== 200) {
    return `受众 ${f.id} 现在投放状态不可用（投放状态 ${f.deliveryStatusCode}），投不出去，所以没建`
  }
  if (f.countLowerBound !== null && f.countLowerBound < MIN_INCLUDED_AUDIENCE_SIZE) {
    return `受众 ${f.id} 太小（不足 ${MIN_INCLUDED_AUDIENCE_SIZE} 人），Meta 不会投，所以没建`
  }
  return null
}

/** 排除受众：状态不可用、或状态和人数全读不到，都拒建 —— 排除名单失效等于老客人还会看到广告。 */
function excludedAudienceError(f: AudienceFact): string | null {
  if (f.operationStatusCode !== null && f.operationStatusCode !== 200) {
    return `排除名单 ${f.id} 还没准备好（状态 ${f.operationStatusCode}）。排除名单不可用 = 已付款的老客人仍会看到广告，所以没建`
  }
  if (f.deliveryStatusCode !== null && f.deliveryStatusCode !== 200) {
    return `排除名单 ${f.id} 现在投放状态不可用（投放状态 ${f.deliveryStatusCode}）。排除名单不可用 = 已付款的老客人仍会看到广告，所以没建`
  }
  if (f.operationStatusCode === null && f.deliveryStatusCode === null && f.countLowerBound === null) {
    return `读不到排除名单 ${f.id} 的状态和人数，核实不了它是不是真的在排除人。排除名单不可用 = 已付款的老客人仍会看到广告，所以没建`
  }
  return null
}

/** 给人看的一行受众摘要；没有受众时返回空串。 */
export function renderAudienceSummary(checked: AudiencesChecked | null | undefined): string {
  if (!checked) return ''
  const parts = [
    ...checked.included.map((f) => renderFact('包含', f)),
    ...checked.excluded.map((f) => renderFact('排除', f)),
  ]
  return parts.length === 0 ? '' : `受众：${parts.join('；')}`
}

function renderFact(label: '包含' | '排除', f: AudienceFact): string {
  const who = f.name ?? f.id
  const count = f.countLowerBound === null ? '人数读不到' : `约 ${f.countLowerBound} 人`
  const code = f.operationStatusCode ?? f.deliveryStatusCode
  const status = code === null ? '状态读不到' : `状态 ${code}`
  return `${label}「${who}」${count}（${status}）`
}
