export type {
  AdsAgentCorrection,
  AdsCorrectionKind,
  AdsCorrectionRecordsFile,
  ExamCandidateQuestion,
} from './types'
export { CORRECTION_RECORD_SCHEMA_VERSION } from './types'
export {
  assertValidCorrectionsFile,
  validateCorrectionRecord,
  validateCorrectionsFile,
  type CorrectionValidationError,
  type CorrectionValidationResult,
} from './validate'
export {
  correctionRecordsPath,
  loadAdsAgentCorrections,
  loadCorrectionRecordsFile,
  validateStoredCorrections,
} from './load'
export {
  CORRECTION_CANDIDATE_TEST_FILE,
  buildExamCandidatesFromCorrections,
  correctionIsPromoted,
  correctionToExamCandidate,
  listCorrectionsPendingCandidates,
} from './to-candidate'
import { loadAdsAgentCorrections } from './load'
import { buildExamCandidatesFromCorrections } from './to-candidate'

export function loadExamCorrectionCandidates(): readonly import('./types').ExamCandidateQuestion[] {
  return buildExamCandidatesFromCorrections(loadAdsAgentCorrections())
}

export function countExamCorrectionCandidates(): number {
  return loadExamCorrectionCandidates().length
}
