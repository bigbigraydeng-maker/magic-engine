/** Plain-language lines for the agree card and the plan-draft receipt. */

export const PLAN_DRAFT_OVERLAP_NOTE = '批准前先退回或归档旧计划，不然两份计划的预算会加在一起。'

export const PLAN_DRAFT_MISSING_LINE = '计划草稿还没有生成记录。'

export function planDraftCreatedLine(version: number): string {
  return `已根据处方第 ${version} 版起草一份未批准的推广计划。还没批准，不会开投，也不会花钱。`
}

export function planDraftAlreadyLine(version: number): string {
  return `这份处方的第 ${version} 版已经有一份计划草稿，没有再生成第二份。`
}

export function planDraftMissingPlaysLine(): string {
  return '没有生成推广计划草稿：这份处方里没有广告打法。缺了打法就不知道要投什么，所以不编一份。'
}

export function planDraftNotEnabledLine(): string {
  return '这个客户还没打开自动起草推广计划，所以没有生成草稿。'
}

export function planDraftNoPeriodLine(): string {
  return '目标没有推广周期。'
}

export function planDraftNoCountryLine(): string {
  return '没有客户配置里的投放国家，也没有已保存受众，这一步不写入。'
}

export function planDraftNetworkLine(escalated: boolean): string {
  const reason = escalated
    ? '计划草稿连续 3 次没生成，原因是网络连接中断。已记到今日待办。'
    : '计划草稿没生成，原因是网络连接中断。已自动重试。'
  return `${reason}这不影响后来批准这份处方。`
}

export function planDraftEventNotSentLine(): string {
  return '计划草稿没生成，原因是重试没有排上。这不影响后来批准这份处方。'
}

export function withOverlap(text: string, overlap: boolean): string {
  if (!overlap) return text
  return `${text}${PLAN_DRAFT_OVERLAP_NOTE}`
}

interface ReceiptLike {
  reason_text?: unknown
}

function receiptOf(meta: unknown): ReceiptLike | null {
  if (!meta || typeof meta !== 'object') return null
  const planDraft = (meta as { plan_draft?: unknown }).plan_draft
  if (!planDraft || typeof planDraft !== 'object') return null
  return planDraft as ReceiptLike
}

/** One line for the agree card. Missing receipt stays explicit. */
export function planDraftCardLine(generationMeta: unknown): string {
  const receipt = receiptOf(generationMeta)
  if (!receipt || typeof receipt.reason_text !== 'string' || receipt.reason_text.trim() === '') {
    return PLAN_DRAFT_MISSING_LINE
  }
  return receipt.reason_text
}
