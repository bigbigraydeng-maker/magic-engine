/**
 * Independent review of an ads proposal before it can wait for a person.
 * Pure: no database, no Meta, no card write. Pass or return only.
 * The rubric is the exam's existing red lines and gradeAgentExamAnswer.
 * Question-specific must-include lines are not applied here: those belong
 * to one exam item, not to every live draft.
 */

import type { AdDraft } from './ad-draft'
import { gradeAgentExamAnswer } from './exam/agent-grade'
import { agentExamProposalRedlines } from './exam/agent-catalog'
import { AGENT_REDLINE_LABELS, type AgentExamRedlineKind } from './exam/agent-redlines'

export interface AdsIndependentReview {
  readonly verdict: 'pass' | 'return'
  readonly reason: string
  readonly redline?: AgentExamRedlineKind
}

const PASS_REASON = '通过。考卷红线没有拦住。仍要人点确认。'

export function reviewAdsAgentText(text: string): AdsIndependentReview {
  const grade = gradeAgentExamAnswer(
    { mustInclude: [], redlines: agentExamProposalRedlines() },
    { text },
  )
  if (grade.redline) {
    return { verdict: 'return', reason: AGENT_REDLINE_LABELS[grade.redline], redline: grade.redline }
  }
  if (grade.point !== 1) {
    const missing = grade.missing?.filter((item) => item.trim()).join('、')
    return { verdict: 'return', reason: missing || '考卷判分没过' }
  }
  return { verdict: 'pass', reason: PASS_REASON }
}

export function draftProposalText(draft: AdDraft): string {
  const sets = draft.adSets
  const names = sets ? sets.map((set) => set.name) : [draft.adSetName]
  const creatives = sets ? sets.flatMap((set) => set.creatives) : draft.creatives
  return [
    draft.campaignName,
    ...names,
    ...creatives.flatMap((item) => [item.name, item.primaryText, item.headline, item.description ?? '']),
  ].filter((line) => line.trim()).join('\n')
}
