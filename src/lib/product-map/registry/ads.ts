/** ads 泳道 —— 广告优化闭环（legacy 在跑,P21.J）。 */

import type { ProductMapComponent } from '../types'

export const ADS_COMPONENTS: readonly ProductMapComponent[] = [
  {
    id: 'playbook.ads-optimisation-loop',
    name: '广告优化闭环（诊断 → 草稿 → 审批 → 执行 → 回读）',
    componentType: 'playbook',
    businessLane: 'ads',
    dapeStages: ['analysis', 'prescription', 'authorization', 'execution', 'verification'],
    businessOutcome: '广告问题被诊断出来,改法先出草稿过闸,批了才动钱,动完回读验证',
    description:
      'legacy 在跑的完整闭环：日常洞察 → 基线对比 → 出草稿 + 硬性闸（预算顶等） → 人批 → 执行 → 回读核对「名字≠真在做的事」。',
    origin: 'legacy',
    operationalStatus: 'operating_legacy',
    legacyOperationalNote: 'ad-readback-sweep 每日回读;执行走 meta-ads execute 路由',
    declaredMaturity: 'M3_INTEGRATED',
    dependencies: [
      { type: 'consumes', target: 'adapter.meta' },
      { type: 'consumes', target: 'adapter.google-ads' },
    ],
    linkedIssues: [],
    linkedPullRequests: [],
    ownedPaths: ['src/lib/ads-strategy/'],
    contractEvidence: [],
    integrationEvidence: [
      { kind: 'caller_cron', ref: 'src/app/api/cron/ad-readback-sweep/route.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
  {
    id: 'adapter.google-ads',
    name: '连 Google 广告的插头',
    componentType: 'adapter',
    businessLane: 'ads',
    dapeStages: ['execution', 'verification'],
    businessOutcome: 'Google 广告的读取与受控改动有统一入口和护栏',
    description: 'legacy 在跑：campaign 读写 + 凭据加载 + 护栏。',
    origin: 'legacy',
    operationalStatus: 'operating_legacy',
    declaredMaturity: 'M3_INTEGRATED',
    dependencies: [],
    linkedIssues: [],
    linkedPullRequests: [],
    ownedPaths: ['src/lib/google-ads/'],
    contractEvidence: [],
    integrationEvidence: [
      { kind: 'caller_route', ref: 'src/app/api/clients/[id]/google-ads/execute/route.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
]
