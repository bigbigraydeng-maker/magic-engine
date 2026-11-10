import type { PrescriptionStatus } from '@/types/diagnostic'

/** 处方状态 → 页面人话（不含 JSON / 内部字段名）。 */
export function prescriptionStatusLabel(status: PrescriptionStatus): string {
  switch (status) {
    case 'generating':
      return '生成中'
    case 'failed':
      return '生成失败'
    case 'draft':
      return '草稿'
    case 'approved':
      return '已批'
    case 'rejected':
      return '已驳回'
    case 'superseded':
      return '被替换'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}
