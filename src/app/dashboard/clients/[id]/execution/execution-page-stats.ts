import { isAutonomousItem, type ItemWithLogs } from './execution-view-model'

export interface ExecutionBoardStats {
  done: number
  total: number
  stuck: number
  automated: number
  open: number
}

export function executionBoardStats(items: ItemWithLogs[]): ExecutionBoardStats {
  const active = items.filter(i => i.status !== 'superseded')
  const done = active.filter(i => i.status === 'completed').length
  const open = active.filter(i => i.status === 'pending' || i.status === 'in_progress').length
  const stuck = active.filter(i => {
    const pr = i.content_state?.priority
    if (pr === 'failed' || pr === 'stale') return true
    return i.logs.some(l => l.kind === 'blocker')
  }).length
  const automated = active.filter(i => isAutonomousItem(i) && i.status !== 'completed').length
  return { done, total: active.length, stuck, automated, open }
}
