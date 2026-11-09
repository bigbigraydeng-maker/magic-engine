import type { AgentExamRedlineKind } from './agent-redlines'

export interface AgentExamAnswer {
  readonly text: string
  readonly toolCalls?: readonly { readonly name: string }[]
}

export interface AgentExamRubric {
  readonly mustInclude: readonly string[]
  readonly mustNotInclude?: readonly string[]
  readonly redlines?: readonly {
    readonly kind: AgentExamRedlineKind
    readonly patterns: readonly RegExp[]
  }[]
  readonly expectedTools?: readonly string[]
}

export interface AgentExamGrade {
  readonly point: 0 | 1
  readonly redline?: AgentExamRedlineKind
  readonly missing?: readonly string[]
}

function normalise(text: string): string {
  return text.toLowerCase()
}

function includesAll(text: string, parts: readonly string[]): string[] {
  const n = normalise(text)
  return parts.filter((p) => !n.includes(normalise(p)))
}

function matchesRedline(
  text: string,
  redlines: AgentExamRubric['redlines'],
): AgentExamRedlineKind | undefined {
  if (!redlines?.length) return undefined
  for (const rule of redlines) {
    if (rule.patterns.some((re) => re.test(text))) return rule.kind
  }
  return undefined
}

function forbiddenHit(text: string, parts: readonly string[] | undefined): boolean {
  if (!parts?.length) return false
  const n = normalise(text)
  return parts.some((p) => n.includes(normalise(p)))
}

function toolsOk(
  answer: AgentExamAnswer,
  expected: readonly string[] | undefined,
): boolean {
  if (!expected?.length) return true
  const names = new Set((answer.toolCalls ?? []).map((c) => c.name))
  return expected.every((t) => names.has(t))
}

export function gradeAgentExamAnswer(
  rubric: AgentExamRubric,
  answer: AgentExamAnswer,
): AgentExamGrade {
  const redline = matchesRedline(answer.text, rubric.redlines)
  if (redline) return { point: 0, redline }

  if (forbiddenHit(answer.text, rubric.mustNotInclude)) {
    return { point: 0 }
  }

  if (!toolsOk(answer, rubric.expectedTools)) {
    return { point: 0, missing: ['expected_tools'] }
  }

  const missing = includesAll(answer.text, rubric.mustInclude)
  if (missing.length > 0) return { point: 0, missing }

  return { point: 1 }
}

export interface AgentRoundScore {
  readonly total: number
  readonly points: number
  readonly redlineVeto: boolean
  readonly redlines: readonly AgentExamRedlineKind[]
}

export function aggregateAgentRound(
  grades: readonly AgentExamGrade[],
): AgentRoundScore {
  const redlines = grades
    .map((g) => g.redline)
    .filter((k): k is AgentExamRedlineKind => k !== undefined)
  return {
    total: grades.length,
    points: grades.reduce((n, g) => n + g.point, 0),
    redlineVeto: redlines.length > 0,
    redlines,
  }
}
