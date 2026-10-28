import { CHAIN_STATE_LABEL, type ChainStatus, type ChainStep, type ChainStepId, type ChainStepState } from '@/lib/prescription-chain/types'
import { stageLinks } from './links'
import {
  PROJECT_STAGE_IDS,
  PROJECT_STAGE_LABEL,
  type ProjectInput,
  type ProjectStageId,
  type ProjectStageView,
} from './types'

const CHAIN_GROUPS: Readonly<Record<Exclude<ProjectStageId, 'check' | 'tune'>, readonly ChainStepId[]>> = {
  inspect: ['inspect'],
  measure: ['measure'],
  confirm: ['confirm'],
  prescribe: ['prescribe', 'consent'],
  act: ['plan', 'creative', 'draft', 'launch'],
}

function stepOf(chain: ChainStatus, id: ChainStepId): ChainStep | null {
  return chain.steps.find((step) => step.id === id) ?? null
}

function viewOf(
  input: ProjectInput,
  id: ProjectStageId,
  state: ChainStepState,
  detail: string,
): ProjectStageView {
  return {
    id,
    label: PROJECT_STAGE_LABEL[id],
    state,
    stateLabel: CHAIN_STATE_LABEL[state],
    detail,
    links: stageLinks({
      stage: id,
      clientId: input.clientId,
      goalId: input.goalId,
      prescriptionId: input.prescriptionId,
    }),
  }
}

/** The first step that is not finished decides the group. A later unread read does not hide it. */
export function rollup(steps: ChainStep[]): { state: ChainStepState; detail: string } {
  if (steps.length === 0) return { state: 'waiting', detail: '' }
  if (steps.every((step) => step.state === 'done')) {
    return { state: 'done', detail: steps[steps.length - 1]?.detail ?? '' }
  }
  const firstOpen = steps.find((step) => step.state !== 'done')
  if (!firstOpen) return { state: 'waiting', detail: '' }
  if (firstOpen.state === 'waiting') {
    const unread = steps.find((step) => step.state === 'unread')
    if (unread) return { state: 'unread', detail: unread.detail }
    return { state: 'waiting', detail: '' }
  }
  return { state: firstOpen.state, detail: firstOpen.detail }
}

function fromChain(input: ProjectInput, chain: ChainStatus, id: Exclude<ProjectStageId, 'check' | 'tune'>): ProjectStageView {
  const steps = CHAIN_GROUPS[id].map((stepId) => stepOf(chain, stepId)).filter((step): step is ChainStep => step !== null)
  const rolled = rollup(steps)
  return viewOf(input, id, rolled.state, rolled.detail)
}

function inspectWithoutChain(input: ProjectInput): ProjectStageView {
  if (input.brandScan === 'unread') return viewOf(input, 'inspect', 'unread', '读不到')
  if (input.brandScan === 'missing') {
    return viewOf(input, 'inspect', 'blocked', '还没有确认过的品牌扫描，开不了方。')
  }
  return viewOf(input, 'inspect', 'done', '品牌扫描已经确认。')
}

function beforePrescription(input: ProjectInput): ProjectStageView[] {
  const prescribe = input.brandScan === 'confirmed'
    ? viewOf(input, 'prescribe', 'active', '还没开方。去跟华佗说这一轮要什么、每月多少预算。')
    : viewOf(input, 'prescribe', 'waiting', '')
  return [
    inspectWithoutChain(input),
    viewOf(input, 'measure', 'waiting', ''),
    viewOf(input, 'confirm', 'waiting', ''),
    prescribe,
    viewOf(input, 'act', 'waiting', ''),
    viewOf(input, 'check', 'waiting', ''),
    viewOf(input, 'tune', 'waiting', ''),
  ]
}

function checkAndTune(input: ProjectInput, chain: ChainStatus): { check: ProjectStageView; tune: ProjectStageView } {
  const launch = stepOf(chain, 'launch')
  if (!launch || launch.state === 'unread') {
    return {
      check: viewOf(input, 'check', 'unread', '读不到'),
      tune: viewOf(input, 'tune', 'unread', '读不到'),
    }
  }
  if (launch.state !== 'done') {
    return {
      check: viewOf(input, 'check', 'waiting', ''),
      tune: viewOf(input, 'tune', 'waiting', ''),
    }
  }
  if (input.review === 'unread') {
    return {
      check: viewOf(input, 'check', 'unread', '读不到'),
      tune: viewOf(input, 'tune', 'unread', '读不到'),
    }
  }
  if (input.review === null) {
    return {
      check: viewOf(input, 'check', 'active', '已经开投，还没有复盘。'),
      tune: viewOf(input, 'tune', 'waiting', ''),
    }
  }
  return {
    check: viewOf(input, 'check', 'done', '有一份复盘。'),
    tune: viewOf(input, 'tune', 'active', '候选经验在广告引擎页采纳。这里不另开一条批准。'),
  }
}

export function projectStages(input: ProjectInput): ProjectStageView[] {
  if (!input.prescriptionId) return beforePrescription(input)
  if (!input.chain) {
    return PROJECT_STAGE_IDS.map((id) => viewOf(input, id, 'unread', '这张方已经存在，但进度这次没读到。刷新后再看。'))
  }
  const chain = input.chain
  const later = checkAndTune(input, chain)
  const stages = PROJECT_STAGE_IDS.map((id) => {
    if (id === 'check') return later.check
    if (id === 'tune') return later.tune
    return fromChain(input, chain, id)
  })
  return stages
}

export function currentStage(stages: readonly ProjectStageView[]): ProjectStageView {
  const open = stages.find((stage) => stage.state === 'active' || stage.state === 'blocked' || stage.state === 'unread')
  if (open) return open
  return stages.find((stage) => stage.state !== 'done') ?? stages[stages.length - 1]
}
