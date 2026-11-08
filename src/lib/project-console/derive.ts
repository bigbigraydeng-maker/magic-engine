import { currentStage, projectStages } from './stages'
import type { ProjectInput, ProjectView } from './types'
import { projectNumbers } from './numbers'
import { projectWaiting } from './waiting'

/** Pure. Same input always produces the same project. Does not read or write. */
export function deriveProject(input: ProjectInput): ProjectView {
  const stages = projectStages(input)
  const numbers = projectNumbers(input.figures)
  const consent = input.chain?.steps.find((step) => step.id === 'consent')
  return {
    clientId: input.clientId,
    clientName: input.clientName,
    goalId: input.goalId,
    goalTitle: input.goalTitle,
    prescriptionId: input.prescriptionId,
    current: currentStage(stages),
    stages,
    waiting: projectWaiting(input),
    numbers: numbers.numbers,
    numbersNote: numbers.note,
    showConsent: consent?.state === 'active',
    goLiveDraftIds: Array.isArray(input.goLiveDraftIds) ? input.goLiveDraftIds : [],
    goLiveUnread: input.goLiveDraftIds === 'unread',
  }
}

/** Projects that need a person come first. Names are the tie break. */
export function compareProjects(left: ProjectView, right: ProjectView): number {
  const rank = (view: ProjectView) => (view.waiting ? 0 : 1)
  const byWait = rank(left) - rank(right)
  if (byWait !== 0) return byWait
  return left.clientName.localeCompare(right.clientName, 'zh')
}
