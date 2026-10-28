import type { ProjectLink, ProjectStageId } from './types'

export function goalLine(input: { goalId: string | null; goalTitle: string | null }): string {
  if (input.goalTitle) return input.goalTitle
  if (input.goalId) return '目标名字这次没读到'
  return '还没挂目标'
}

function clientPath(clientId: string, tail: string): string {
  return `/dashboard/clients/${encodeURIComponent(clientId)}${tail}`
}

export function prescriptionHref(clientId: string, prescriptionId: string | null, goalId: string | null): string {
  const base = `/dashboard/clients/${encodeURIComponent(clientId)}/prescription/new`
  if (prescriptionId) return `${base}?prescription_id=${encodeURIComponent(prescriptionId)}`
  if (!goalId) return base
  return `${base}?goal_id=${encodeURIComponent(goalId)}`
}

export function stageLinks(input: {
  stage: ProjectStageId
  clientId: string
  goalId: string | null
  prescriptionId: string | null
}): ProjectLink[] {
  const { stage, clientId, goalId, prescriptionId } = input
  const scan = { label: '去做品牌扫描', href: clientPath(clientId, '/zhangqian') }
  const prescribe = {
    label: prescriptionId ? '打开这张方' : '去跟华佗开方',
    href: prescriptionHref(clientId, prescriptionId, goalId),
  }
  if (stage === 'inspect') return [scan]
  if (stage === 'measure') {
    return [goalId
      ? { label: '看这个目标', href: clientPath(clientId, `/goal/${encodeURIComponent(goalId)}`) }
      : { label: '去建目标', href: clientPath(clientId, '/goal/new') }]
  }
  if (stage === 'confirm') return [{ label: '跟华佗说需求', href: prescribe.href }]
  if (stage === 'prescribe') return [prescribe]
  if (stage === 'act') {
    return [
      { label: '推广计划', href: clientPath(clientId, '/promo-plan') },
      { label: '素材', href: clientPath(clientId, '/content-factory') },
      { label: '落地页检查', href: clientPath(clientId, '/promo-plan') },
      { label: '暂停草稿', href: clientPath(clientId, '/confirmation-cards') },
      { label: '开投', href: '/dashboard/ad-approval' },
    ]
  }
  if (stage === 'check') {
    return [
      { label: '看投放', href: clientPath(clientId, '/ads-health') },
      { label: '去复盘', href: clientPath(clientId, '/execution') },
    ]
  }
  return [{ label: '到广告引擎看经验', href: '/dashboard/ad-engine' }]
}
