/**
 * Tune writes a lesson only through writeGlobalLesson, and only as a candidate.
 * isActive defaults to true on that function, so this wrapper always passes false.
 * Evidence is marked candidate. The ad engine page is what turns it on.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  writeGlobalLesson,
  type LessonInput,
  type LessonProvenance,
  type LessonScope,
  type WriteLessonResult,
} from './write-lesson'

export const TUNE_CANDIDATE_STATUS = 'candidate'

export interface TuneCandidateInput {
  lessonKey: string
  scope: LessonScope
  industry?: string | null
  flywheel?: string | null
  lesson: string
  rationale?: string | null
  confidence: number
  evidence?: Record<string, unknown> | null
  provenance?: LessonProvenance
}

/** Inactive until a person adopts it. Caller cannot override isActive. */
export async function writeTuneCandidateLesson(
  supabase: SupabaseClient,
  input: TuneCandidateInput,
): Promise<WriteLessonResult> {
  const lesson: LessonInput = {
    lessonKey: input.lessonKey,
    scope: input.scope,
    industry: input.industry,
    flywheel: input.flywheel,
    lesson: input.lesson,
    rationale: input.rationale,
    confidence: input.confidence,
    provenance: input.provenance,
    evidence: { ...(input.evidence ?? {}), status: TUNE_CANDIDATE_STATUS },
    isActive: false,
  }
  return writeGlobalLesson(supabase, lesson)
}

/** Waiting to be adopted. Already-on lessons and plain retired rows are not this. */
export function isAdoptionCandidate(
  isActive: boolean,
  evidence: Record<string, unknown> | null | undefined,
): boolean {
  if (isActive || !evidence) return false
  if (evidence.status === TUNE_CANDIDATE_STATUS) return true
  return evidence.kind === 'tune_candidate' || evidence.kind === 'expert_rss_candidate'
}
