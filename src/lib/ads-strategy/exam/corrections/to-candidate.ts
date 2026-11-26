import type { AdsAgentCorrection, ExamCandidateQuestion } from './types'

export const CORRECTION_CANDIDATE_TEST_FILE =
  'src/lib/ads-strategy/exam/__tests__/correction-candidates.test.ts'

function candidateQuestionId(seq: number): string {
  return `QC${String(seq).padStart(2, '0')}`
}

function candidateTitle(correction: AdsAgentCorrection): string {
  const wrong = correction.wrongSummary.replace(/\s+/g, ' ').trim()
  const right = correction.correctSummary.replace(/\s+/g, ' ').trim()
  if (wrong.length > 48) {
    return `纠正：${right.slice(0, 72)}${right.length > 72 ? '…' : ''}`
  }
  return `纠正（曾错：${wrong.slice(0, 40)}${wrong.length > 40 ? '…' : ''}）→ ${right.slice(0, 56)}${right.length > 56 ? '…' : ''}`
}

function candidateMatch(correctionId: string): string {
  return `【考卷候选 ${correctionId}】`
}

/** 已升入正式考卷 → 不再参与候选输出。 */
export function correctionIsPromoted(correction: AdsAgentCorrection): boolean {
  const id = correction.promoted_to?.trim()
  return id !== undefined && id !== '' && /^Q\d{2}$/.test(id)
}

/** 未晋升的纠正记录（供候选题与统计）。 */
export function listCorrectionsPendingCandidates(
  corrections: readonly AdsAgentCorrection[],
): readonly AdsAgentCorrection[] {
  return corrections.filter((c) => !correctionIsPromoted(c))
}

/** 把一条纠正记录转成考卷候选题（不写入正式题库）。 */
export function correctionToExamCandidate(
  correction: AdsAgentCorrection,
  seq: number,
): ExamCandidateQuestion {
  return {
    lifecycle: 'candidate',
    correctionId: correction.id,
    id: candidateQuestionId(seq),
    title: candidateTitle(correction),
    source: `correction:${correction.id}`,
    file: CORRECTION_CANDIDATE_TEST_FILE,
    match: candidateMatch(correction.id),
    expect: 'todo',
  }
}

/** 未晋升纠正 → 候选题列表（顺序与 records.json 一致，跳过 promoted_to）。 */
export function buildExamCandidatesFromCorrections(
  corrections: readonly AdsAgentCorrection[],
): readonly ExamCandidateQuestion[] {
  return listCorrectionsPendingCandidates(corrections).map((c, i) =>
    correctionToExamCandidate(c, i + 1),
  )
}

