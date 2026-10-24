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
import { seoMetaCycleFanOut, seoMetaCycleRunOne } from './seo-meta-cycle'
import { seoMetaRankSamplerFanOut, seoMetaRankSamplerOne } from './seo-meta-rank-sampler'
import { competitorWatchWeeklyFanOut, competitorWatchRunOne } from './competitor-watch-weekly'
import { aiVisibilityWeeklyFanOut, aiVisibilityTrackerRunOne } from './ai-visibility-weekly'
import { reelBatchRender } from './reel-batch-render'
import { adsD3AutoPause } from './ads-d3-auto-pause'
import { leadSheetSyncFanOut, leadSheetSyncOne } from './lead-sheet-sync'
import { calendarClosureAudit } from './calendar-closure-audit'
import { promoPlanDailyWatch } from './promo-plan-daily-watch'
import { adHeartbeat } from './ad-heartbeat'
import { adsTrackingPreflight } from './ads-tracking-preflight'
import { adsTrackingLaunchWatch } from './ads-tracking-launch-watch'
import { crmLeadFollowupDigest } from './crm-lead-followup-digest'
import { adsAutonomySyncFunction } from './ads-autonomy-sync'
import { adsCampaignBudgetDecrease } from './ads-campaign-budget'
import { adsO1BudgetScale } from './ads-o1-budget-scale'
import { maliangRenderCheck } from './maliang-render-check'
import { libaiCopyProvenance } from './libai-copy-provenance'
import { libaiPromptLibraryMonthly } from './libai-prompt-library-monthly'
import { simaqianReputationWeekly } from './simaqian-reputation-weekly'
import { gscPageDailyFanOut, gscPageDailyPull } from './gsc-page-daily'
import { gscQueryPageDailyFanOut, gscQueryPageDailyPull } from './gsc-query-page-daily'
import { toolsLabLeadFollowUp, toolsLabReportEmailReceipt } from './tools-lab-lead-followup'
import { dailyPlanAutoPublish } from './daily-plan-auto-publish'
import { youtubeStaging, youtubePublicStep } from './youtube-publish'
import { storyLitePublish } from './story-lite-publish'
import { telephonyVoiplineProcess, telephonyVoiplineSweep } from './telephony-voipline'
import { telephonyCallAnalysis, telephonyCallAnalysisSweep } from './telephony-analysis'

export const cloudFunctions = [
  promoPlanDailyWatch,
  adHeartbeat,
  adsTrackingPreflight,
  adsTrackingLaunchWatch,
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
  seoMetaCycleFanOut,
  seoMetaCycleRunOne,
  seoMetaRankSamplerFanOut,
  seoMetaRankSamplerOne,
  competitorWatchWeeklyFanOut,
  competitorWatchRunOne,
  aiVisibilityWeeklyFanOut,
  aiVisibilityTrackerRunOne,
  reelBatchRender,
  adsD3AutoPause,
  leadSheetSyncFanOut,
  leadSheetSyncOne,
  calendarClosureAudit,
  crmLeadFollowupDigest,
  adsAutonomySyncFunction,
  adsCampaignBudgetDecrease,
  adsO1BudgetScale,
  maliangRenderCheck,
  libaiCopyProvenance,
  libaiPromptLibraryMonthly,
  simaqianReputationWeekly,
  gscPageDailyFanOut,
  gscPageDailyPull,
  gscQueryPageDailyFanOut,
  gscQueryPageDailyPull,
  toolsLabLeadFollowUp,
  toolsLabReportEmailReceipt,
  dailyPlanAutoPublish,
  youtubeStaging,
  youtubePublicStep,
  storyLitePublish,
  telephonyVoiplineProcess,
  telephonyVoiplineSweep,
  telephonyCallAnalysis,
  telephonyCallAnalysisSweep,
]

/** 命名空间自检：所有注册函数 id 必须以 cloud- 开头（契约测试 + 运行期双保险）。 */
for (const fn of cloudFunctions) {
  if (!fn.id().startsWith(CLOUD_FN_PREFIX)) {
    throw new Error(`云端函数 id 必须以 ${CLOUD_FN_PREFIX} 开头，实际：${fn.id()}`)
  }
}
