/** social 泳道 —— 内容工厂产片发布线（legacy 在跑）。 */

import type { ProductMapComponent } from '../types'

export const SOCIAL_COMPONENTS: readonly ProductMapComponent[] = [
  {
    id: 'playbook.social-video-factory',
    name: '视频工厂（排产 → 出片 → 发布）',
    componentType: 'playbook',
    businessLane: 'social',
    dapeStages: ['prescription', 'execution', 'verification'],
    businessOutcome: '客户社媒每天有片发,从排产到发布不用人盯',
    description:
      'legacy 在跑的多步固定流程：工单排产、素材/字幕/配音、成片、定时发布、发布回执。人只审成片。',
    origin: 'legacy',
    operationalStatus: 'operating_legacy',
    legacyOperationalNote: 'factory-order-scheduler / factory-publish-worker / factory-publish-sweeper 等 cron 全天在跑',
    declaredMaturity: 'M3_INTEGRATED',
    dependencies: [
      { type: 'consumes', target: 'adapter.meta', note: 'Facebook reel 直发线' },
    ],
    linkedIssues: [],
    linkedPullRequests: [],
    ownedPaths: ['src/lib/factory/'],
    contractEvidence: [],
    integrationEvidence: [
      { kind: 'caller_cron', ref: 'src/app/api/cron/factory-publish-worker/route.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
]
