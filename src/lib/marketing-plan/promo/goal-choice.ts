/** 目标下拉的一行字。只用目标自己的标题、状态和日期，不补示例句子。 */

export function formatGoalChoice(goal: {
  title: string
  status: string
  period_start: string
  period_end: string
}): string {
  const state = goal.status === 'draft' ? '草稿' : goal.status === 'active' ? '进行中' : goal.status
  const start = goal.period_start || '起止未填'
  const end = goal.period_end || '起止未填'
  return `${goal.title}（${state}，${start} 至 ${end}）`
}
