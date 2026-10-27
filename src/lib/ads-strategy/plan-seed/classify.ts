import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'
import type { AdPlay } from './ad-plays'
import { judgeEligibility } from './eligibility'
import type { AccountData, EligibilityOutcome, PassingStep, SharedContext } from './shared'

/** 账户快照里的币种；读不到或为空时返回 null。 */
export function currencyOfFacts(facts: AdsDraftFacts | null): string | null {
  if (facts === null) return null
  if (facts.headroom.ok !== true) return null
  const cur = facts.headroom.currency.trim()
  return cur === '' ? null : cur
}

/** 账户级可用余量：日上限 - 在投预算；读不全按 0 算。 */
export function accountLevelRoom(facts: AdsDraftFacts | null): number {
  if (facts === null) return 0
  if (facts.account_cap_minor === null || facts.account_delivering_minor === null) return 0
  return Math.max(0, facts.account_cap_minor - facts.account_delivering_minor)
}

/** 客户余量与账户余量取小；读不全按 0 算（用于排序）。 */
export function accountRoom(facts: AdsDraftFacts | null): number {
  if (facts === null) return 0
  const headroomClient = facts.headroom.ok ? facts.headroom.headroom_minor : null
  const acct = accountLevelRoom(facts)
  const acctKnown = facts.account_cap_minor !== null && facts.account_delivering_minor !== null
  if (headroomClient === null || !acctKnown) return 0
  return Math.min(headroomClient, acct)
}

/** 判断某个账户的币种是否已知。 */
export function currencyKnownFor(facts: AdsDraftFacts | null): boolean {
  if (facts === null) return true
  if (facts.headroom.ok !== true) return true
  return facts.headroom.currency.trim() !== ''
}

/** 对某个打法 + 某个账户做合格性判断。 */
export function evaluateEligibility(
  play: AdPlay,
  account: AccountData,
  ctx: SharedContext,
): EligibilityOutcome {
  return judgeEligibility({
    play: play.play,
    pageId: ctx.pageId,
    pageToken: ctx.pageToken,
    scopes: ctx.scopes,
    forms: ctx.forms,
    accountStatus: account.facts?.account_status ?? null,
    currencyKnown: currencyKnownFor(account.facts),
    promotePages: account.promotePages,
    tokenSource: ctx.tokenSource,
    accountId: account.id,
  })
}

/** 在合格账户里挑余量最大的（并列取候选顺序靠前的）。 */
export function pickAccount(
  play: AdPlay,
  accounts: AccountData[],
  ctx: SharedContext,
): { passing: PassingStep | null; reasons: string[] } {
  const reasons: string[] = []
  const eligibleAccounts: AccountData[] = []
  let best: PassingStep | null = null
  let bestRoom = -1
  for (const account of accounts) {
    const outcome = evaluateEligibility(play, account, ctx)
    if (!outcome.eligible) {
      reasons.push(`${account.id}：${outcome.why_empty ?? '不合格'}`)
      continue
    }
    eligibleAccounts.push(account)
    const room = accountRoom(account.facts)
    if (room > bestRoom) {
      bestRoom = room
      best = { play, accountId: account.id, account, eligibility: outcome, eligibleAccounts }
    }
  }
  return { passing: best, reasons }
}

/** 判断"没有合格账户"是否因为读不到（读不到≠没有）；返回原因或 null。 */
export function unknownReason(
  play: AdPlay,
  accounts: AccountData[],
  ctx: SharedContext,
): string | null {
  const reasons: string[] = []
  const add = (r: string): void => {
    if (!reasons.includes(r)) reasons.push(r)
  }
  if (ctx.pageId !== null && ctx.pageId !== '' && ctx.pageToken.state === 'failed') {
    add('主页访问令牌')
  }
  if (play.play === 'lead_form_harvest' && ctx.scopes.state === 'failed') {
    add('令牌权限')
  }
  if (play.play === 'lead_form_harvest' && ctx.forms.state === 'failed') {
    add('表单列表')
  }
  if (accounts.some((a) => (a.facts?.account_status ?? null) === null)) {
    add('账户状态')
  }
  return reasons.length === 0 ? null : reasons.join('、')
}

/** 把每个打法映射到"通过 / 跳过"的结果。 */
export function classifyPlays(
  plays: AdPlay[],
  accounts: AccountData[],
  ctx: SharedContext,
): {
  passing: PassingStep[]
  skipped: { step_key: string; why_empty: string }[]
  unknownDrops: { step_key: string; reason: string }[]
} {
  const passing: PassingStep[] = []
  const skipped: { step_key: string; why_empty: string }[] = []
  const unknownDrops: { step_key: string; reason: string }[] = []
  for (const play of plays) {
    const { passing: chosen, reasons } = pickAccount(play, accounts, ctx)
    if (chosen === null) {
      skipped.push({
        step_key: play.step_key,
        why_empty: `没有合格的广告账户：${reasons.join('；')}`,
      })
      const unknown = unknownReason(play, accounts, ctx)
      if (unknown !== null) {
        unknownDrops.push({ step_key: play.step_key, reason: unknown })
      }
      continue
    }
    passing.push(chosen)
  }
  return { passing, skipped, unknownDrops }
}
