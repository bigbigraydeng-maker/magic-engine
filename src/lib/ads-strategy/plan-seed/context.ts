import type { AdPlay } from './ad-plays'
import type { ReadState } from './eligibility'
import { safe, type AccountData, type Candidate, type PlanSeedDeps } from './shared'

/** 读一个账户的快照、抓取时间、可推广主页（每个账户只读一次）。 */
export async function loadAccountData(
  clientId: string,
  accountId: string,
  deps: PlanSeedDeps,
): Promise<AccountData> {
  const [factsRes, captureRes, promoteRes] = await Promise.all([
    safe(() => deps.loadFacts(clientId, accountId)),
    safe(() => deps.loadCaptureAt(clientId, accountId)),
    safe(() => deps.readPromotePages(clientId, accountId)),
  ])
  const facts = factsRes.ok ? factsRes.value : null
  const captureAt = captureRes.ok ? captureRes.value : null
  const promotePages: ReadState<string[]> = promoteRes.ok
    ? promoteRes.value
    : { state: 'failed', reason: promoteRes.reason }
  return { id: accountId, facts, captureAt, promotePages }
}

/** 并发读取所有候选账户的数据。 */
export async function loadAllAccounts(
  clientId: string,
  candidates: Candidate[],
  deps: PlanSeedDeps,
): Promise<AccountData[]> {
  return Promise.all(candidates.map((c) => loadAccountData(clientId, c.id, deps)))
}

/** 读取主页与令牌，返回共享上下文的一部分。 */
export async function loadPageContext(
  clientId: string,
  deps: PlanSeedDeps,
): Promise<{ pageId: string | null; pageToken: ReadState<true>; pageTokenValue: string | null }> {
  const pageRes = await safe(() => deps.loadClientPageId(clientId))
  const pageId = pageRes.ok ? pageRes.value : null
  if (pageId === null || pageId === '') {
    return { pageId: null, pageToken: { state: 'failed', reason: '客户没配主页' }, pageTokenValue: null }
  }
  const tokenRes = await safe(() => deps.getPageToken(clientId, pageId))
  if (!tokenRes.ok) {
    return { pageId, pageToken: { state: 'failed', reason: tokenRes.reason }, pageTokenValue: null }
  }
  if (tokenRes.value === null || tokenRes.value === '') {
    return { pageId, pageToken: { state: 'empty' }, pageTokenValue: null }
  }
  return { pageId, pageToken: { state: 'ok', value: true }, pageTokenValue: tokenRes.value }
}

/** 读取令牌权限（只读一次）。 */
export async function loadScopes(
  clientId: string,
  deps: PlanSeedDeps,
): Promise<{ tokenSource: string | null; scopes: ReadState<string[]> }> {
  const res = await safe(() => deps.readScopes(clientId))
  if (!res.ok || res.value === null) {
    return { tokenSource: null, scopes: { state: 'failed', reason: '没有可用令牌' } }
  }
  return { tokenSource: res.value.source, scopes: res.value.scopes }
}

/** 读取即时表单（只读一次，且只在需要时）。 */
export async function loadForms(
  plays: AdPlay[],
  pageId: string | null,
  pageToken: ReadState<true>,
  pageTokenValue: string | null,
  deps: PlanSeedDeps,
): Promise<ReadState<{ id: string; active: boolean }[]>> {
  const needsForms = plays.some((p) => p.play === 'lead_form_harvest')
  if (!needsForms || pageId === null || pageId === '' || pageToken.state !== 'ok' || pageTokenValue === null) {
    return { state: 'empty' }
  }
  const res = await safe(() => deps.readForms(pageId, pageTokenValue))
  if (!res.ok) return { state: 'failed', reason: res.reason }
  return res.value
}

/** 读取客户名下账户；失败或为空时返回原因。 */
export async function loadCandidates(
  clientId: string,
  deps: PlanSeedDeps,
): Promise<{ candidates: Candidate[]; why: string | null }> {
  const res = await safe(() => deps.loadOwnedAccounts(clientId))
  if (!res.ok) return { candidates: [], why: '读不到客户名下账户' }
  if (res.value === null) return { candidates: [], why: '读不到客户名下账户' }
  if (res.value.length === 0) return { candidates: [], why: '客户名下没有广告账户' }
  return { candidates: res.value, why: null }
}
