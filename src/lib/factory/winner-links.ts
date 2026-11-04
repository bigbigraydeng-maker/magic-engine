/**
 * 「当前广告样板」那一块在哪、怎么链过去：一处写，页面标签 / 今日待办 / 工厂页小链接都从这里取。
 * 标签名字常量放这里（lib），广告健康页的 tabs.ts 引它；有一条守卫测试盯着两边对得上。
 */

const APP_BASE = 'https://app.magicengine.com.au'

/** 广告健康页 `?tab=` 的值 */
export const WINNER_ADS_TAB = 'winners' as const

/** 标签上的字 */
export const WINNER_TAB_LABEL = '广告样板'

/** 站内相对路径（页面小链接用） */
export function winnerBoardPath(clientId: string): string {
  return `/dashboard/clients/${encodeURIComponent(clientId)}/ads-health?tab=${WINNER_ADS_TAB}`
}

/** 完整网址（今日待办 / 邮件用） */
export function winnerBoardUrl(clientId: string): string {
  return `${APP_BASE}${winnerBoardPath(clientId)}`
}
