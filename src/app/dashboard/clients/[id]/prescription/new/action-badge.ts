import type { PrescriptionAction } from '@/types/diagnostic'

const MANUAL_BADGE = { label: '人工执行', cls: 'bg-purple-100 text-purple-700' }

/** Badge shown on a prescription action. Manual work is labelled 人工执行. */
export function actionFixBadge(action: Pick<PrescriptionAction, 'fix_type' | 'module'>): {
  label: string
  cls: string
} {
  if (action.fix_type === 'fde_manual' || action.module === 'manual') return MANUAL_BADGE
  if (action.fix_type === 'me_auto') return { label: 'ME', cls: 'bg-blue-100 text-blue-700' }
  return { label: '第三方', cls: 'bg-gray-100 text-gray-600' }
}

/** Hide the module chip when it would repeat the manual badge. */
export function showActionModuleChip(action: Pick<PrescriptionAction, 'module'>): boolean {
  return !!action.module && action.module !== 'manual'
}
