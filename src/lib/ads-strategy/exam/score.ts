import type { ExamQuestion } from './questions'

/** 一条测试的运行结果（来自 vitest JSON 报告）。file 是绝对或相对路径都行，按「以题目 file 结尾」匹配。 */
export interface ExamTestResult {
  readonly file: string
  readonly fullName: string
  /** vitest 的状态：passed / failed / skipped / pending / todo / disabled */
  readonly status: string
}

export type ExamVerdict =
  | 'right' // expect pass，命中的测试全部 passed
  | 'wrong' // expect pass，有测试没 passed（failed / skipped / pending 等）
  | 'known_fail' // expect known_fail，命中的测试全部 passed（代码仍答错，跟登记一致）
  | 'known_fail_now_right' // expect known_fail，有测试 failed：代码已经答对，该把 it.fails 改成 it
  | 'todo' // expect todo，命中的测试全部是 todo
  | 'missing' // 一条测试都没命中（测试被改名或删了）

export interface ExamQuestionResult {
  readonly question: ExamQuestion
  readonly verdict: ExamVerdict
  readonly matched: number
}

export interface ExamScore {
  readonly results: readonly ExamQuestionResult[]
  readonly total: number
  readonly right: number
  readonly wrong: number
  readonly knownFail: number
  readonly knownFailNowRight: number
  readonly todo: number
  readonly missing: number
  /** 有 wrong 或 missing 时为 false（脚本据此退出码 1）。 */
  readonly ok: boolean
}

function normalise(file: string): string {
  return file.replace(/\\/g, '/')
}

function matchesQuestion(question: ExamQuestion, test: ExamTestResult): boolean {
  return (
    normalise(test.file).endsWith(question.file) &&
    test.fullName.includes(question.match)
  )
}

function allStatuses(tests: readonly ExamTestResult[], status: string): boolean {
  return tests.every((t) => t.status === status)
}

function verdictForPass(tests: readonly ExamTestResult[]): ExamVerdict {
  return allStatuses(tests, 'passed') ? 'right' : 'wrong'
}

function verdictForKnownFail(tests: readonly ExamTestResult[]): ExamVerdict {
  if (tests.some((t) => t.status === 'failed')) return 'known_fail_now_right'
  if (allStatuses(tests, 'passed')) return 'known_fail'
  return 'wrong'
}

function verdictFor(
  question: ExamQuestion,
  tests: readonly ExamTestResult[],
): ExamVerdict {
  if (tests.length === 0) return 'missing'
  if (question.expect === 'todo') {
    return allStatuses(tests, 'todo') ? 'todo' : verdictForPass(tests)
  }
  if (question.expect === 'known_fail') return verdictForKnownFail(tests)
  return verdictForPass(tests)
}

function scoreQuestion(
  question: ExamQuestion,
  tests: readonly ExamTestResult[],
): ExamQuestionResult {
  const matched = tests.filter((t) => matchesQuestion(question, t))
  return { question, verdict: verdictFor(question, matched), matched: matched.length }
}

function countVerdict(
  results: readonly ExamQuestionResult[],
  verdict: ExamVerdict,
): number {
  return results.filter((r) => r.verdict === verdict).length
}

export function scoreExam(
  questions: readonly ExamQuestion[],
  tests: readonly ExamTestResult[],
): ExamScore {
  const results = questions.map((q) => scoreQuestion(q, tests))
  const wrong = countVerdict(results, 'wrong')
  const missing = countVerdict(results, 'missing')
  return {
    results,
    total: results.length,
    right: countVerdict(results, 'right'),
    wrong,
    knownFail: countVerdict(results, 'known_fail'),
    knownFailNowRight: countVerdict(results, 'known_fail_now_right'),
    todo: countVerdict(results, 'todo'),
    missing,
    ok: wrong === 0 && missing === 0,
  }
}

const VERDICT_ICON: Readonly<Record<ExamVerdict, string>> = {
  right: '✅',
  wrong: '❌',
  known_fail: '🟡',
  known_fail_now_right: '🔁',
  todo: '⬜',
  missing: '⚠️',
}

function summaryLines(score: ExamScore): string[] {
  const lines: string[] = [
    `广告考卷：答对 ${score.right} / 共 ${score.total} 题（已知待修 ${score.knownFail}，还没出题 ${score.todo}）`,
  ]
  if (score.wrong > 0) {
    lines.push(`❌ 答错 ${score.wrong} 题——原来对的题被改错了，先别合并`)
  }
  if (score.missing > 0) {
    lines.push(`⚠️ 找不到 ${score.missing} 题对应的测试——测试被改名或删了，改登记表`)
  }
  if (score.knownFailNowRight > 0) {
    lines.push(
      `🔁 ${score.knownFailNowRight} 道待修题现在答对了——把对应的 it.fails 改成 it，登记表改成 pass`,
    )
  }
  return lines
}

function questionLine(result: ExamQuestionResult): string {
  const { question, verdict } = result
  return `${VERDICT_ICON[verdict]} ${question.id} ${question.title}  ←${question.source}`
}

export function formatScoreboard(score: ExamScore): string {
  const lines = [...summaryLines(score), '', ...score.results.map(questionLine)]
  return lines.join('\n')
}
