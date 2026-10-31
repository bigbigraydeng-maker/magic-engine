/** Plain-language result of trying to record a deal after a payment. */

export interface DealNotice {
  recorded: boolean
  alreadyRecorded: boolean
  reason: string | null
  message: string
}

export const MISSING_PARTY_MESSAGE = '订单没有人数，不能按标价估算，成交记录没有写成。'

export function readDealNotice(data: unknown): DealNotice | null {
  if (typeof data !== 'object' || data === null) return null
  const deal = (data as { deal?: unknown }).deal
  if (typeof deal !== 'object' || deal === null) return null
  const row = deal as { recorded?: unknown; alreadyRecorded?: unknown; reason?: unknown; message?: unknown }
  if (typeof row.message !== 'string' || row.message.trim() === '') return null
  return {
    recorded: row.recorded === true,
    alreadyRecorded: row.alreadyRecorded === true,
    reason: typeof row.reason === 'string' ? row.reason : null,
    message: row.message,
  }
}

export function dealSettled(notice: DealNotice | null): boolean {
  return notice?.recorded === true || notice?.alreadyRecorded === true
}
