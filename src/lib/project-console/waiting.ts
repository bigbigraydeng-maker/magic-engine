import type { ChainStatus, ChainStep, ChainStepId } from '@/lib/prescription-chain/types'
import { prescriptionHref } from './links'
import type { ProjectInput, ProjectWaiting } from './types'

const STAFF = '内部同事'
const APPROVER = '能批处方的内部账号'
const PLAN_APPROVER = '能批计划的内部账号'
const CARD_CLICKER = '这个客户的负责人，或内部批准人'
const GO_LIVE = '能点开投的人'
const GLOBAL_ADMIN = '全局管理员'

function at(clientId: string, tail: string): string {
  return `/dashboard/clients/${encodeURIComponent(clientId)}${tail}`
}

function step(chain: ChainStatus, id: ChainStepId): ChainStep | null {
  return chain.steps.find((item) => item.id === id) ?? null
}

function notStarted(input: ProjectInput): ProjectWaiting {
  const scan = { card: '去做品牌扫描', who: STAFF, href: at(input.clientId, '/zhangqian') }
  if (input.brandScan === 'unread') return { ...scan, card: '品牌扫描这次没读到' }
  if (input.brandScan === 'missing') return scan
  return {
    card: '去跟华佗开方',
    who: STAFF,
    href: prescriptionHref(input.clientId, null, input.goalId),
  }
}

function chainWaiting(input: ProjectInput, chain: ChainStatus): ProjectWaiting | null {
  const clientId = input.clientId
  const prescribeHref = prescriptionHref(clientId, input.prescriptionId, input.goalId)
  for (const id of ['inspect', 'measure', 'confirm', 'prescribe', 'consent', 'plan', 'creative', 'draft', 'launch'] as const) {
    const found = step(chain, id)
    if (!found || found.state === 'waiting') continue
    if (found.state === 'done') {
      if (id === 'draft' && input.pausedDraftPending === true) {
        return { card: '暂停草稿确认卡', who: CARD_CLICKER, href: at(clientId, '/confirmation-cards') }
      }
      continue
    }
    if (found.state === 'unread') return { card: `${found.label}这一步读不到`, who: '先别当成完成', href: prescribeHref }
    return clickFor(input, id, found, prescribeHref)
  }
  const launch = step(chain, 'launch')
  if (launch?.state === 'done') return afterLaunch(input)
  return null
}

function clickFor(input: ProjectInput, id: ChainStepId, found: ChainStep, prescribeHref: string): ProjectWaiting | null {
  const clientId = input.clientId
  if (id === 'prescribe' && found.detail.includes('正在开方')) return null
  if (id === 'consent') return { card: '同意这张方', who: APPROVER, href: prescribeHref }
  if (id === 'plan' && found.detail.includes('草稿')) {
    return { card: '批准推广计划', who: PLAN_APPROVER, href: at(clientId, '/promo-plan') }
  }
  if (id === 'draft' && input.pausedDraftPending === 'unread') {
    return { card: '暂停草稿确认卡这次没读到', who: '先别当成没有', href: at(clientId, '/confirmation-cards') }
  }
  if (id === 'draft' && input.pausedDraftPending === true) {
    return { card: '暂停草稿确认卡', who: CARD_CLICKER, href: at(clientId, '/confirmation-cards') }
  }
  if (id === 'launch') return { card: '开投确认卡', who: GO_LIVE, href: '/dashboard/ad-approval' }
  return { card: found.detail || found.label, who: STAFF, href: prescribeHref }
}

function afterLaunch(input: ProjectInput): ProjectWaiting | null {
  if (input.review === 'unread') {
    return { card: '复盘这次没读到', who: '先别当成没有', href: at(input.clientId, '/execution') }
  }
  if (input.review === null) {
    return { card: '去看投放和复盘', who: STAFF, href: at(input.clientId, '/ads-health') }
  }
  return { card: '到广告引擎采纳候选经验', who: GLOBAL_ADMIN, href: '/dashboard/ad-engine' }
}

export function projectWaiting(input: ProjectInput): ProjectWaiting | null {
  if (!input.prescriptionId) return notStarted(input)
  if (!input.chain) return { card: '链路这次没读到', who: '先别当成完成', href: at(input.clientId, '/promo-plan') }
  return chainWaiting(input, input.chain)
}
