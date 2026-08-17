/**
 * geo 泳道 —— ME2 的参考闭环（史诗 #872，客户 Roman Hu）。
 *
 * 这是唯一真跑过生产的 ME2 链条：契约(WP02) → 存储(WP03) → 执行(WP04) →
 * 真 provider 接线(WP04A) → Roman Baseline v1（batch 688bd8ae，12/12 观测，
 * US$0.708，2026-08-12）。链上的组件带 production 证据到 M4；
 * 没有任何组件到 M5 —— baseline 是一次性的，还没有重复 Outcome。
 */

import type { ProductMapComponent } from '../types'

const ROMAN_BATCH = '688bd8ae-2db6-4300-b761-b850f30c32c5'

export const GEO_COMPONENTS: readonly ProductMapComponent[] = [
  {
    id: 'platform.geo-measurement-contract',
    name: 'AI 可见度的测量口径',
    componentType: 'platform',
    architecturalRole: 'measurement',
    businessLane: 'geo',
    dapeStages: ['discovery', 'verification'],
    businessOutcome: '「这次测的 AI 可见度能不能跟上次比」有唯一判定标准，测量结果不再各说各话',
    description: '定死了「一次测量算什么、两次能不能比」—— 不然每次测出来的数不能放一起看。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M3_INTEGRATED',
    dependencies: [],
    linkedIssues: [876],
    linkedPullRequests: [{ number: 894, role: 'implements' }],
    ownedPaths: ['src/lib/geo-measurement/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [
      { kind: 'importer', ref: 'src/lib/geo-baseline/parser.ts', verification: 'manual_claim' },
      { kind: 'importer', ref: 'src/lib/geo-measurement-store/types.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
  {
    id: 'platform.geo-measurement-store',
    name: 'AI 可见度测量结果的存档',
    componentType: 'platform',
    // WP00 §3.3 Measurement 的"证据保全"边界：不可变存储是它的落地形态。
    architecturalRole: 'measurement',
    businessLane: 'geo',
    dapeStages: ['discovery', 'outcome'],
    businessOutcome: '测量结果一旦写入就改不了，半年后还能证明「当时真是这么测的」',
    description:
      '写进去就改不了(数据库层面锁死)。生产库里已经躺着 Roman 那次基线的真实数据 —— 这一点是数出来的,不是账本上写的。',
    origin: 'me2_native',
    // 数据躺在生产 ≠ 在运营:整条 geo 链还没有 recurring 写入,与 runtime 口径一致
    operationalStatus: 'not_operating',
    declaredMaturity: 'M4_PRODUCTION_VALIDATED',
    dependencies: [{ type: 'implements', target: 'platform.geo-measurement-contract', note: '行形状实现契约身份' }],
    linkedIssues: [875],
    linkedPullRequests: [{ number: 897, role: 'implements' }],
    ownedPaths: ['src/lib/geo-measurement-store/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [
      { kind: 'importer', ref: 'src/lib/geo-baseline/store.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [
      {
        kind: 'production_data',
        ref: 'geo_batches=3 / geo_observations=25 / geo_evidence=12（生产实读，ROADMAP 记录）',
        observedAt: '2026-08-12',
        verification: 'manual_claim',
      },
    ],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
  {
    id: 'capability.geo-measurement-runtime',
    name: '跑一批 AI 可见度测量',
    componentType: 'capability',
    // WP00 §3.3 Measurement 的"覆盖率与成本的如实记录"边界：预算闸 + 观测循环
    // 是这一条的落地，不是 Shared Capability（后者是"准备可评审改动"）。
    architecturalRole: 'measurement',
    businessLane: 'geo',
    dapeStages: ['discovery', 'execution'],
    businessOutcome: '按冻结计划跑一批测量：预算预检、逐条观测、对账落库,超预算就停',
    description: '冻结计划校验 + 预算闸 + 观测循环 + 原子落库对账。fake provider/store 供测试。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M4_PRODUCTION_VALIDATED',
    dependencies: [
      { type: 'consumes', target: 'platform.geo-measurement-contract' },
      { type: 'requires', target: 'platform.geo-measurement-store' },
    ],
    linkedIssues: [874],
    linkedPullRequests: [{ number: 914, role: 'implements' }],
    ownedPaths: ['src/lib/geo-measurement-runtime/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [
      { kind: 'importer', ref: 'scripts/geo-baseline-run.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [
      {
        kind: 'production_run',
        ref: `batch ${ROMAN_BATCH}（12/12 观测，US$0.708 / 上限 US$5.00）`,
        observedAt: '2026-08-12',
        verification: 'manual_claim',
      },
    ],
    learningEvidence: [],
    currentBlockers: [
      { id: 'no-recurring-cadence', kind: 'code', summary: '只跑过一次 baseline,没有排期的重复测量（WP08 余项 / WP09）', ref: '#932' },
    ],
    poDecisionRequired: [],
    nextMilestone: { target: 'M5_OPERATING_AND_LEARNING', unlockedBy: ['no-recurring-cadence'] },
    ownerRole: 'claude-code',
  },
  {
    // name 不带真实供应商名(CLAUDE.md 封装名铁律,UI 会展示 name);id 是内部标识可保留
    id: 'adapter.geo-baseline-openai',
    name: 'AI 可见度实测接线(连到 Content Engine)',
    componentType: 'adapter',
    // B2：supporting artifact 不占顶层七角色。它是 capability.geo-measurement-runtime
    // 的零件，语义靠 adapterOf 继承父组件（measurement），**自己不设 architecturalRole**
    // —— 类型层已把 Me2SupportingComponent.architecturalRole 锁成 never。
    adapterOf: 'capability.geo-measurement-runtime',
    businessLane: 'geo',
    dapeStages: ['execution'],
    businessOutcome: '测量计划能真的打到 AI 引擎上拿回答案和引用',
    description:
      '真 provider/parser/store 接线（代码头自称「一次性接线，不是平台能力」）。Roman Baseline v1 就是它跑出来的。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M4_PRODUCTION_VALIDATED',
    dependencies: [{ type: 'adapts', target: 'capability.geo-measurement-runtime' }],
    linkedIssues: [917],
    linkedPullRequests: [{ number: 922, role: 'implements' }],
    ownedPaths: ['src/lib/geo-baseline/'],
    contractEvidence: [
      {
        kind: 'frozen_contract',
        ref: 'docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [
      { kind: 'importer', ref: 'scripts/geo-baseline-run.ts', verification: 'manual_claim' },
    ],
    productionEvidence: [
      {
        kind: 'production_run',
        ref: `batch ${ROMAN_BATCH}`,
        observedAt: '2026-08-12',
        verification: 'manual_claim',
      },
    ],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
  {
    id: 'module.geo-visibility',
    name: 'GEO 分析脑',
    componentType: 'module',
    // WP00 §3.2 明文点名："GEO Module（#879）是第一个 Domain Module"。
    architecturalRole: 'domain_module',
    businessLane: 'geo',
    dapeStages: ['analysis', 'prescription'],
    businessOutcome: '把测量结果解释成「你在 AI 搜索里缺什么、该修哪几页」的发现和处方',
    description:
      '怎么做已经定死了(2026-08-12),但还没批准开工,而且要等「客户网站页面清单」那件事先做完。',
    origin: 'me2_native',
    operationalStatus: 'not_operating',
    declaredMaturity: 'M1_CONTRACT_FROZEN',
    dependencies: [
      { type: 'consumes', target: 'platform.growth-contract' },
      { type: 'consumes', target: 'capability.geo-measurement-runtime' },
      { type: 'requires', target: 'registry.canonical-page-inventory', note: '页面级处方要落在可信台账上' },
    ],
    linkedIssues: [879, 930],
    linkedPullRequests: [],
    ownedPaths: [],
    contractEvidence: [
      {
        // ref 用 Issue 指针而非 ROADMAP 路径:ROADMAP 按纪律「只留未完成」,
        // 冻结记录迟早被清走,路径型 ref 会指向空气
        kind: 'frozen_contract',
        ref: 'bigbigraydeng-maker/magic-engine#879',
        note: 'geo-module/m1/v1 语义冻结（2026-08-12,Build Control Room 记录在案）',
        verification: 'manual_claim',
      },
    ],
    integrationEvidence: [],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [
      { id: 'page-ledger-remainder', kind: 'code', summary: '页面台账余项（store 实现 + 权威源）未完成', ref: '#932' },
      { id: 'implementation-not-authorized', kind: 'authorization', summary: 'Build Control Room 尚未授权 WP05 实施', ref: '#879' },
    ],
    poDecisionRequired: [
      {
        kind: 'scope',
        decision:
          '批准开工做 GEO 分析脑。**在等「客户网站页面清单」那件事做完,还没轮到你** —— 做完了会自动出现在待办里。届时:不做,AI 可见度只有测量数字没有解读;做了,测出来的数能变成「该改哪几页」的处方。',
      },
    ],
    nextMilestone: { target: 'M2_IMPLEMENTED', unlockedBy: ['page-ledger-remainder', 'implementation-not-authorized'] },
    ownerRole: 'build-control-room',
  },
  {
    id: 'registry.industry-brand-canonical',
    name: '行业品牌别名登记册',
    componentType: 'registry',
    businessLane: 'geo',
    dapeStages: ['analysis'],
    businessOutcome: 'AI 回答里出现的品牌各种写法能归一到同一家，可见度统计不重不漏',
    description: 'legacy 在跑：行业 AI 可见度线的品牌标准化查它。尚未进入 ME2 测量契约的身份体系。',
    origin: 'legacy',
    operationalStatus: 'operating_legacy',
    legacyOperationalNote: 'ai-visibility-weekly cron 驱动的行业可见度采集线在用',
    declaredMaturity: 'M3_INTEGRATED',
    dependencies: [],
    linkedIssues: [],
    linkedPullRequests: [],
    ownedPaths: ['src/lib/industry-ai-visibility/brand-standardiser.ts'],
    contractEvidence: [],
    integrationEvidence: [
      {
        kind: 'importer',
        ref: 'src/lib/industry-ai-visibility/collector.ts',
        note: '直接调用方(ai-visibility-weekly cron 经 orchestrator/collector 到它)',
        verification: 'manual_claim',
      },
    ],
    productionEvidence: [],
    learningEvidence: [],
    currentBlockers: [],
    poDecisionRequired: [],
    ownerRole: 'claude-code',
  },
]
