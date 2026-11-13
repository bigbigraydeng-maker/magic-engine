/**
 * Ad engine lesson groups. Candidates wait in their own group.
 * Trial rows stay in the try-out group. Everything else inactive is retired.
 */

import { isAdoptionCandidate, TUNE_ADOPTED_STATUS } from './tune-candidate'

export interface GroupableLesson {
  lesson_key: string
  is_active: boolean
  evidence: Record<string, unknown> | null
}

export interface LessonGroups<T extends GroupableLesson> {
  active: T[]
  trial: T[]
  pending: T[]
  retired: T[]
}

export function groupEngineLessons<T extends GroupableLesson>(
  lessons: readonly T[],
  isTrial: (lesson: T) => boolean,
): LessonGroups<T> {
  const active: T[] = []
  const trial: T[] = []
  const pending: T[] = []
  const retired: T[] = []
  for (const lesson of lessons) {
    if (lesson.is_active) {
      active.push(lesson)
      continue
    }
    if (lesson.evidence?.status === TUNE_ADOPTED_STATUS) {
      retired.push(lesson)
      continue
    }
    if (isTrial(lesson)) {
      trial.push(lesson)
      continue
    }
    if (isAdoptionCandidate(lesson.is_active, lesson.evidence)) pending.push(lesson)
    else retired.push(lesson)
  }
  return { active, trial, pending, retired }
}
