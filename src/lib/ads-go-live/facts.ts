/**
 * Facts printed on the go-live card: layer, daily amount, account, start day.
 * Numbers that were not read stay unreadable. Nothing here is filled in.
 */

import { isApprovableKind } from '@/lib/ads-strategy/ad-draft'
import {
  ConfirmationCardError,
  contentFingerprint,
  normalizeFacts,
  type CardFacts,
  type HardCheck,
} from '@/lib/confirmation-card'
import { chooseAccountLabel } from './account'
import { hardChecksForGoLive, type GoLiveGate } from './checks'
import { goLiveSubjectKey, type PausedDraftView } from './draft'
import { plainClip } from './text'

function moneyLine(budget: number | null): { text: string; problem: HardCheck | null } {
  if (budget === null || budget <= 0) {
    return {
      text: '每天多少钱读不到',
      problem: { label: '每天多少钱', state: 'unread', reason: '草稿上没有每天的金额' },
    }
  }
  const shown = Number.isInteger(budget) ? String(budget) : budget.toFixed(2)
  return { text: `每天 ${shown}，按这个广告账户自己的货币`, problem: null }
}

function dateLine(days: number | null): { text: string; problem: HardCheck | null } {
  if (days === null || !Number.isInteger(days) || days < 1 || days > 30) {
    return {
      text: '开始日读不到',
      problem: { label: '开始日', state: 'unread', reason: '草稿上没有能用的开始天数' },
    }
  }
  return { text: `从点下去的这一天开始，计划跑 ${days} 天`, problem: null }
}

function extraProblems(view: PausedDraftView, accountProblem: string | null): HardCheck[] {
  const extras: HardCheck[] = []
  if (!isApprovableKind(view.kind)) {
    extras.push({ label: '广告类型', state: 'red', reason: '这种广告现在不能开' })
  }
  if (!view.ids) {
    extras.push({ label: '广告编号', state: 'unread', reason: '没记下广告编号，开不了' })
  }
  if (accountProblem) {
    extras.push({ label: '广告账户', state: 'unread', reason: accountProblem })
  }
  const money = moneyLine(view.dailyBudget)
  const date = dateLine(view.durationDays)
  if (money.problem) extras.push(money.problem)
  if (date.problem) extras.push(date.problem)
  return extras
}

function scopeFor(landing: HardCheck): string {
  const lead = landing.state === 'green'
    ? `落地页已核实：${landing.reason}`
    : landing.state === 'red'
      ? `落地页没通过：${landing.reason}`
      : `落地页还没核实：${landing.reason}`
  return plainClip(`开到广告、广告组和广告系列这三层。${lead}`, 180)
}

export function buildGoLiveFacts(input: {
  readonly draftId: string
  readonly view: PausedDraftView
  readonly gates: readonly GoLiveGate[]
  readonly boundLabels: readonly (string | null)[] | null
  readonly landing: HardCheck
}): CardFacts {
  const subjectKey = goLiveSubjectKey(input.draftId)
  if (!subjectKey) {
    throw new ConfirmationCardError('invalid', '这条草稿的编号不对，没有出卡。')
  }
  const account = chooseAccountLabel(input.view.accountLabel, input.boundLabels)
  const accountProblem = 'problem' in account ? account.problem : null
  const money = moneyLine(input.view.dailyBudget)
  const date = dateLine(input.view.durationDays)
  return normalizeFacts({
    subjectKey,
    what: '开投：把暂停的广告改成在投',
    account: 'label' in account ? account.label : account.problem,
    amount: money.text,
    date: date.text,
    scope: scopeFor(input.landing),
    hardChecks: hardChecksForGoLive(
      input.gates,
      extraProblems(input.view, accountProblem),
      input.landing,
    ),
  })
}

export function cardFingerprint(facts: CardFacts): string {
  return contentFingerprint(normalizeFacts(facts))
}
