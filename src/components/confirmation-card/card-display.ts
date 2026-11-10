import type { CardStatus } from '@/lib/confirmation-card/view'

export const STATUS_CHIP_LABEL: Record<CardStatus, string> = {
  waiting: '待确认',
  confirmed: '已确认（还没开始做）',
  declined: '不做',
  expired: '已过期',
  voided: '已作废',
}

const DEADLINE_RE = /请在\s*(\d+)月(\d+)日\s*(\d{1,2}):(\d{2})/

export function touchesMetaAds(what: string): boolean {
  return !what.startsWith('记下')
}

export function expiryBadgeText(expiresLabel: string): string {
  if (/23:59/.test(expiresLabel)) {
    return '今天 23:59 前有效（新西兰时间）'
  }
  const match = DEADLINE_RE.exec(expiresLabel)
  if (!match) return '30 分钟内有效'
  const now = new Date()
  const year = now.getFullYear()
  const month = Number(match[1]) - 1
  const day = Number(match[2])
  const hour = Number(match[3])
  const minute = Number(match[4])
  const deadline = new Date(year, month, day, hour, minute, 0, 0)
  if (deadline.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
    deadline.setFullYear(year + 1)
  }
  const remainingMs = deadline.getTime() - now.getTime()
  const mins = Math.max(0, Math.ceil(remainingMs / 60_000))
  return `30 分钟内有效 · 还剩 ${mins} 分钟`
}

export function isMutedStatus(status: CardStatus): boolean {
  return status === 'expired' || status === 'voided'
}
