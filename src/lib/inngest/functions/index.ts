/** 本应用注册到 Inngest 的全部云端函数登记处（#1346）。新增函数在此追加。 */
import { CLOUD_FN_PREFIX } from '../client'
import { probePing } from './probe'
import { geoRemeasureOne } from './geo-remeasure'
import { dailyPlanPostFanOut, dailyPlanPostMeasure } from './daily-plan-post-measurement'
import { ctsSiteCacheRefresh } from './cts-site-cache-refresh'

export const cloudFunctions = [
  probePing,
  geoRemeasureOne,
  dailyPlanPostFanOut,
  dailyPlanPostMeasure,
  ctsSiteCacheRefresh,
]

/** 命名空间自检：所有注册函数 id 必须以 cloud- 开头（契约测试 + 运行期双保险）。 */
for (const fn of cloudFunctions) {
  if (!fn.id().startsWith(CLOUD_FN_PREFIX)) {
    throw new Error(`云端函数 id 必须以 ${CLOUD_FN_PREFIX} 开头，实际：${fn.id()}`)
  }
}
