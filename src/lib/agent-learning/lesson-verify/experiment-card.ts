/**
 * 广告"建议实验"卡片：只展示，没有执行入口。
 * 真要做，走广告发布流程（计划批准 + 开投批准），系统自己不开广告、不花钱。
 */
export interface ExperimentCard {
  hypothesis: string
  budgetCapNzd: number
  durationDays: number
  successRule: string
  failureRule: string
  approver: string
}

export function buildExperimentCard(lesson: string): ExperimentCard {
  return {
    hypothesis: lesson,
    budgetCapNzd: 200,
    durationDays: 14,
    successRule: '对照组与实验组预算、受众、时段相同，实验组的核心结果指标（线索成本或转化成本）更优，且至少各 30 个转化。',
    failureRule: '指标不优于对照组，或转化不足 30 个：判定未证实，不采用。',
    approver: 'Ray 审批后，经广告发布流程执行',
  }
}
