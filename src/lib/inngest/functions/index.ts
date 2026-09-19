/** 本应用注册到 Inngest 的全部云端函数登记处（#1346）。新增函数在此追加。 */
import { webIntelligenceCapture, webIntelligenceDue, webIntelligenceTrafficDue } from './web-intelligence'
import { CLOUD_FN_PREFIX } from '../client'
import { probePing } from './probe'
import { geoRemeasureOne } from './geo-remeasure'
import { dailyPlanPostFanOut, dailyPlanPostMeasure } from './daily-plan-post-measurement'
import { dailyPlanPostStoryResolve } from './daily-plan-post-story-resolve'
import { factoryReelMeasurementAdapter } from './factory-reel-measurement-adapter'
import { flywheelSeoWeeklyFanOut, flywheelSeoSnapshotOne } from './flywheel-seo-weekly'
import { messengerBriefAfterSync } from './messenger-brief-after-sync'
import { factoryCreatomateRender } from './factory-creatomate-render'
import { knowledgeMiningRequested } from './knowledge-mining'
import { conversationInboundAutoAck } from './conversation-inbound-autoack'
import { conversionDailyPipeline } from './conversion-daily-pipeline'
import { conversationInboundDraft } from './conversation-inbound-draft'
import { conversationHealthHeartbeat } from './conversation-health-heartbeat'
import { postPublishFanOut, postPublishCheck } from './seo-post-publish-monitor'

export const cloudFunctions = [
  webIntelligenceCapture,
  webIntelligenceDue,
  webIntelligenceTrafficDue,
  probePing,
  geoRemeasureOne,
  dailyPlanPostFanOut,
  dailyPlanPostMeasure,
  dailyPlanPostStoryResolve,
  factoryReelMeasurementAdapter,
  flywheelSeoWeeklyFanOut,
  flywheelSeoSnapshotOne,
  messengerBriefAfterSync,
  factoryCreatomateRender,
  knowledgeMiningRequested,
  conversationInboundAutoAck,
  conversionDailyPipeline,
  conversationInboundDraft,
  conversationHealthHeartbeat,
  postPublishFanOut,
  postPublishCheck,
]

/** 命名空间自检：所有注册函数 id 必须以 cloud- 开头（契约测试 + 运行期双保险）。 */
for (const fn of cloudFunctions) {
  if (!fn.id().startsWith(CLOUD_FN_PREFIX)) {
    throw new Error(`云端函数 id 必须以 ${CLOUD_FN_PREFIX} 开头，实际：${fn.id()}`)
  }
}
