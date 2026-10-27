import type { ClientKind, DiagnosticDimension, PrescriptionIntake } from '@/types/diagnostic'
import { parsePrescriptionAsk, readShootAnswer, type ParsedAsk } from './utterance'

export interface GoalChoice {
  id: string
  title: string
}

export interface DecideInput {
  text: string
  prescriptionStatus: string | null
  prescriptionId: string | null
  discoveryReady: boolean
  goals: GoalChoice[]
  selectedGoalId: string | null
  pendingGoal: string | null
  pendingBudget: number | null
  waitingFor: 'budget' | 'goal' | 'shoot' | null
  /** 客户资料里的客户类型（clients.client_kind）。缺省 = 普通客户。 */
  clientKind?: ClientKind
  /** 追问过的「每周能拍几条」，等选目标时带着走。 */
  pendingShoot?: number | null
  supplementOf: string | null
  reviseOf: string | null
  writing: boolean
}

export type TurnDecision =
  | { kind: 'say'; text: string }
  | {
      kind: 'ask'
      waitingFor: 'budget' | 'goal' | 'shoot'
      businessGoal: string
      budget: number | null
      shoot?: number | null
      text: string
    }
  | { kind: 'refine'; comments: string }
  | {
      kind: 'generate'
      businessGoal: string
      budget: number
      urgency: PrescriptionIntake['timeline_urgency']
      dimensions: DiagnosticDimension[]
      goalId: string | null
      clientKind: ClientKind
      weeklyShoot: number | null
      mode: 'new' | 'supplement' | 'revise'
      priorId: string | null
    }

export function decideTurn(input: DecideInput): TurnDecision {
  if (input.writing || input.prescriptionStatus === 'generating') {
    return say('还在写，写完了再发下一句。')
  }
  if (input.waitingFor === 'goal') return answerGoal(input)
  if (input.waitingFor === 'budget') return answerBudget(input)
  if (input.waitingFor === 'shoot') return answerShoot(input)
  return decideFresh(input, parsePrescriptionAsk(input.text))
}

export function matchGoal(goals: GoalChoice[], text: string): string | null {
  const trimmed = text.trim()
  const index = Number(trimmed)
  if (Number.isInteger(index) && index >= 1 && index <= goals.length) return goals[index - 1].id
  const hit = goals.find((goal) => trimmed.includes(goal.title) || goal.title.includes(trimmed))
  return hit?.id ?? null
}

function decideFresh(input: DecideInput, ask: ParsedAsk): TurnDecision {
  const forcedNew = Boolean(input.supplementOf || input.reviseOf || ask.wantsNewDraft)
  if (input.prescriptionStatus === 'approved' && !forcedNew) {
    return say('这版已经同意。要调整的话，说「再开一版」，并写上每月预算。')
  }
  if (input.prescriptionStatus === 'draft' && !forcedNew) {
    return { kind: 'refine', comments: input.text.trim() }
  }
  return decideGenerate(input, ask)
}

function answerBudget(input: DecideInput): TurnDecision {
  const budget = parsePrescriptionAsk(input.text).monthlyBudget
  if (budget == null) return say('没看懂金额。请直接回每月预算，例如 3700。')
  const prior = parsePrescriptionAsk(input.pendingGoal ?? '')
  return decideGenerate(input, { ...prior, businessGoal: input.pendingGoal ?? '', monthlyBudget: budget, wantsNewDraft: true })
}

function answerShoot(input: DecideInput): TurnDecision {
  const shoot = readShootAnswer(input.text)
  if (shoot == null) return say('没看懂条数。请直接回本人每周能拍几条，例如 3。')
  const prior = parsePrescriptionAsk(input.pendingGoal ?? '')
  return decideGenerate(
    { ...input, waitingFor: null },
    { ...prior, businessGoal: input.pendingGoal ?? '', monthlyBudget: input.pendingBudget, weeklyShoot: shoot, wantsNewDraft: true },
  )
}

function answerGoal(input: DecideInput): TurnDecision {
  const goalId = matchGoal(input.goals, input.text)
  if (!goalId) return say('没对上目标。请回复序号，或把目标名字再说一遍。')
  const prior = parsePrescriptionAsk(input.pendingGoal ?? '')
  return decideGenerate(
    { ...input, selectedGoalId: goalId, waitingFor: null },
    {
      ...prior,
      businessGoal: input.pendingGoal ?? '',
      monthlyBudget: input.pendingBudget,
      weeklyShoot: input.pendingShoot ?? prior.weeklyShoot,
      wantsNewDraft: true,
    },
  )
}

/** 客户类型从资料读，不靠关键词猜；只有对话里明说「按普通客户开」才临时改回。 */
function effectiveKind(input: DecideInput, ask: ParsedAsk): ClientKind {
  if (ask.forceStandard) return 'standard'
  return input.clientKind ?? 'standard'
}

function decideGenerate(input: DecideInput, ask: ParsedAsk): TurnDecision {
  const businessGoal = ask.businessGoal || input.pendingGoal || ''
  const budget = ask.monthlyBudget ?? input.pendingBudget
  if (!businessGoal) return say('先用一句话说说这张方要达成什么。')
  if (budget == null) return askFor('budget', businessGoal, null, '每月大概准备多少预算？直接回一个数字就行。')
  const clientKind = effectiveKind(input, ask)
  const weeklyShoot = ask.weeklyShoot
  if (clientKind === 'personal_ip' && weeklyShoot == null) {
    return { kind: 'ask', waitingFor: 'shoot', businessGoal, budget, text: '本人每周大概能拍几条？直接回一个数字就行。' }
  }
  if (!input.discoveryReady && !input.supplementOf && !input.reviseOf) {
    return say('还没有确认过的品牌扫描，开不了方。')
  }
  const goalId = resolveGoal(input, businessGoal)
  if (goalId === 'need-choice') {
    return { kind: 'ask', waitingFor: 'goal', businessGoal, budget, shoot: weeklyShoot, text: goalPrompt(input.goals) }
  }
  return {
    kind: 'generate',
    businessGoal,
    budget,
    urgency: ask.urgency,
    dimensions: ask.dimensions,
    goalId,
    clientKind,
    weeklyShoot: clientKind === 'personal_ip' ? weeklyShoot : null,
    mode: modeOf(input),
    priorId: priorOf(input),
  }
}

function resolveGoal(input: DecideInput, businessGoal: string): string | null | 'need-choice' {
  if (input.supplementOf || input.reviseOf) return input.selectedGoalId
  if (input.selectedGoalId) return input.selectedGoalId
  if (input.goals.length === 0) return null
  if (input.goals.length === 1) return input.goals[0].id
  return matchGoal(input.goals, businessGoal) ?? 'need-choice'
}

function modeOf(input: DecideInput): 'new' | 'supplement' | 'revise' {
  if (input.supplementOf) return 'supplement'
  if (input.reviseOf || input.prescriptionStatus === 'approved') return 'revise'
  return 'new'
}

function priorOf(input: DecideInput): string | null {
  if (input.supplementOf) return input.supplementOf
  if (input.reviseOf) return input.reviseOf
  if (input.prescriptionStatus === 'approved') return input.prescriptionId
  return null
}

function goalPrompt(goals: GoalChoice[]): string {
  const lines = goals.map((goal, index) => `${index + 1}. ${goal.title}`)
  return ['这张方要挂在哪个目标下？回复序号就行。', ...lines].join('\n')
}

function askFor(
  waitingFor: 'budget' | 'goal',
  businessGoal: string,
  budget: number | null,
  text: string,
): TurnDecision {
  return { kind: 'ask', waitingFor, businessGoal, budget, text }
}

function say(text: string): TurnDecision {
  return { kind: 'say', text }
}
