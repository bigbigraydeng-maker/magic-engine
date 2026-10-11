/**
 * 体检加载器「读客户广告设置失败」的报错口径（只放常量和判断，零依赖）。
 *
 * 加载器读失败会抛错，每日回拉把报错原样记进运行记录的 ad_diagnostics / ads_growth_state 来源；
 * 今日待办靠这里的前缀认出「这是读设置失败」，把它下发成系统欠账——不让它死在运行记录里。
 * 抛错的地方和认错的地方共用同一组常量，改一边另一边不会漂。
 */

export const STRATEGY_CONFIG_READ_FAILED = 'ad_strategy_configs read failed'

export const OUTCOME_CONFIG_READ_FAILED = 'ad outcome config read failed'

export function configReadFailedMessage(prefix: string, detail: string | undefined): string {
  return `${prefix}: ${detail ?? 'unknown error'}`
}

/** 这条报错是不是「体检加载器读设置失败」。 */
export function isAdConfigReadFailure(message: string): boolean {
  return (
    message.startsWith(STRATEGY_CONFIG_READ_FAILED) ||
    message.startsWith(OUTCOME_CONFIG_READ_FAILED)
  )
}
