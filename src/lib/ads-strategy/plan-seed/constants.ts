// 抓取每 6 小时一轮，超过一轮再加半小时宽限仍没有新抓取，就不是最新一轮；服务端和界面共用这一个口径。

/** 抓取每 6 小时一轮 */
export const CAPTURE_CADENCE_MS = 6 * 3600 * 1000
/** 超过一轮再加半小时宽限仍没有新抓取，就不是最新一轮 */
export const STALE_GRACE_MS = 30 * 60 * 1000
export const STALE_AFTER_MS = CAPTURE_CADENCE_MS + STALE_GRACE_MS
export const STALE_LABEL = '6 小时半'

/** 实时读选中账户在投合计的时间上限（毫秒）；超时一律回落到快照。 */
export const LIVE_READ_TIMEOUT_MS = 3000
