/**
 * ME2 Product Map v1 —— 种子 registry 数据（Issue #974）。
 *
 * 🔴 每一条的 `sourcePaths` / `issueNumbers` / `pullRequestNumbers` / `evidence`
 *    都对应本次 repository discovery 里实际核对过的东西（`docs/STATE.md` §3 / §3.1、
 *    `docs/ROADMAP.md`、逐个目录用 `test -d` 验证存在），不是编出来的示例数据。
 *    CLAUDE.md 铁律 8「绝不凭空注入客户业务数据」同样适用于系统自身的 registry ——
 *    这里只登记本仓库真的能查到证据的组件，查不到就不写，宁可留给
 *    「unclassified queue」（`graph.ts` 的 `findUnclassifiedSourcePaths`）。
 *
 * 🔴 `owners` 大量写着 `unassigned-pending-audit`：现有文档（`docs/STATE.md` / `docs/ROADMAP.md`）
 *    按模块记状态，不按组件记具体 owner。诚实标「未分配」比编一个名字更有用 ——
 *    它本身就是 Dashboard 该展示出来的一条缺口，不是这次实现该掩盖的东西。
 *
 * `maturityEvidence` 的判断依据逐条写在 `evidence` 里；`maturity` 字段本身由
 * `validateRegistryComponent`（`../validators.ts`）强制等于 `deriveMaturityCeiling` 的结果，
 * 写错会在 `__tests__/seed-data.test.ts` 里直接报错，不会悄悄通过。
 */

import type { RegistryComponent } from '../types'

const UNASSIGNED_OWNER = 'unassigned-pending-audit'

export const SEED_COMPONENTS: readonly RegistryComponent[] = [
  // ── Platform ──────────────────────────────────────────────────────────────
  {
    componentId: 'me2-execution-kernel',
    type: 'platform',
    name: 'ME2 执行内核',
    description:
      '跨业务线共享的授权 / 网关 / lineage 基础设施。代码已合并 main，但四张核心表与全部 ' +
      'kernel_* RPC 在生产不存在（migration 未 apply），处于「代码在 main、生产未启用」状态。',
    businessLanes: ['shared'],
    dapeStages: ['authorization', 'execution'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/kernel', 'src/lib/action-bridge'],
    issueNumbers: [882],
    pullRequestNumbers: [863, 898],
    riskLevel: 'A',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'pull_request',
        description: '执行内核 v1 主体合并',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/pull/863',
      },
      {
        kind: 'pull_request',
        description: 'K-WP02 ActionCandidate→ActionKey 治理 + per-action 副作用政策合并',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/pull/898',
      },
      {
        kind: 'doc_reference',
        description:
          'docs/STATE.md §3 / §3.1：2026-08-12 实查，action_runs 等四张表与 kernel_* RPC 一个都不存在，' +
          '零执行调用方；仅有一条只读 pm-daily-todo 路径会查询（查不到时被 .catch 收成警告）',
        link: 'docs/STATE.md',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: false,
      hasProductionRunEvidence: false,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M2',
    blockers: [
      {
        statement:
          '生产 migration 20260808000003_me2_execution_kernel_v1.sql 未 apply；apply 是单独授权的运维动作，' +
          '必须 PM 显式 go，不许夹带进任何 PR（docs/STATE.md §3.1）',
        since: '2026-08-10',
      },
    ],
  },

  // ── Capability ────────────────────────────────────────────────────────────
  {
    componentId: 'me2-geo-measurement',
    type: 'capability',
    name: 'ME2 GEO 测量线',
    description:
      '采集身份与解释身份分离的 GEO 测量能力：契约 + 不可变存储 + 执行运行时 + 真 provider/parser 接线。' +
      '生产已真实跑过一次（Roman Baseline v1）。',
    businessLanes: ['geo'],
    dapeStages: ['discovery', 'analysis'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: [
      'src/lib/geo-measurement',
      'src/lib/geo-measurement-store',
      'src/lib/geo-measurement-runtime',
      'src/lib/geo-baseline',
    ],
    issueNumbers: [876, 875, 917],
    pullRequestNumbers: [894, 897, 922],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'production_table',
        description:
          'geo_query_sets / geo_queries / geo_batches / geo_observations / geo_evidence —— 2026-08-12 实查存在，' +
          '3 批次 / 25 观测 / 12 证据，含 Roman Baseline v1（批次 688bd8ae）',
        link: 'docs/STATE.md',
      },
      {
        kind: 'pull_request',
        description: 'WP04A 真 provider / parser / WP03 store 接线，Roman Baseline v1 就是它跑出来的',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/pull/922',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M4',
    blockers: [],
  },
  {
    componentId: 'me2-page-optimization',
    type: 'capability',
    name: 'ME2 共享 Page 能力',
    description: 'resolve / draft / diff / validate 页面优化共享能力。代码在 main，零调用方，未接生产。',
    businessLanes: ['shared'],
    dapeStages: ['prescription', 'execution'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/page-optimization', 'src/lib/capabilities/page-optimization/snapshot.ts'],
    issueNumbers: [878],
    pullRequestNumbers: [895],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'pull_request',
        description: 'WP06 共享 Page 能力 resolve/snapshot/draft/diff/validate 合并',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/pull/895',
      },
      {
        kind: 'doc_reference',
        description: 'docs/STATE.md §3：代码在 main，零调用方；WP06 冻结决定不加表、不加 migration、不持久化',
        link: 'docs/STATE.md',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: false,
      hasProductionRunEvidence: false,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M2',
    blockers: [
      { statement: '零调用方 —— 没有任何 Domain Module 或路由 import 这个能力', since: '2026-08-10' },
    ],
  },
  {
    componentId: 'me2-growth-contract',
    type: 'capability',
    name: 'ME2 Growth 契约',
    description:
      'observe → diagnose → prescribe → propose → verify 五段纯类型 + 纯校验器契约，供 Domain Module 共用。' +
      '代码在 main，全仓无人 import。',
    businessLanes: ['shared'],
    dapeStages: ['discovery', 'analysis', 'prescription'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/growth'],
    issueNumbers: [877],
    pullRequestNumbers: [890],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'pull_request',
        description: 'Growth 契约 WP01 合并（合并提交 700f57e）',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/pull/890',
      },
      {
        kind: 'doc_reference',
        description: 'docs/STATE.md §3.1：`grep -rn "lib/growth" src/ --exclude-dir=growth` 零结果，无表无调用方',
        link: 'docs/STATE.md',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: false,
      hasProductionRunEvidence: false,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M2',
    blockers: [
      { statement: '等 WP05（GEO Module v1，#879）成为首个 Domain Module 消费方', since: '2026-08-10' },
    ],
  },

  // ── Module ────────────────────────────────────────────────────────────────
  {
    componentId: 'module-seo-content-engine',
    type: 'module',
    name: 'SEO 内容引擎',
    description:
      '面向客户的完整 SEO 业务域：关键词研究、内容策略、站点审计、博客生产、GSC 回流。' +
      '仓库现存最成熟的业务模块，服务真实付费客户。',
    businessLanes: ['seo'],
    dapeStages: ['discovery', 'analysis', 'prescription', 'execution', 'outcome'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: ['adapter-dataforseo'],
    consumers: [],
    sourcePaths: [
      'src/lib/blog',
      'src/lib/keywords',
      'src/lib/seo-gap',
      'src/lib/seo-intelligence',
      'src/lib/seo-patrol',
      'src/lib/site-audit',
      'src/lib/page-rewriter',
      'src/lib/gsc',
    ],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'doc_reference',
        description:
          'docs/STATE.md §3：标记「✅ 成熟」，落表 blog_posts / keyword_snapshots / client_site_pages / ' +
          'content_strategy_items / gsc_performance_snapshots',
        link: 'docs/STATE.md',
      },
      {
        kind: 'doc_reference',
        description: 'CLAUDE.md §9：CTS Tours NZ / Oztop 两个真实客户持续在跑 SEO 工作，有工作日志留痕',
        link: 'CLAUDE.md',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: true,
    },
    maturity: 'M5',
    blockers: [],
  },

  // ── Adapter ───────────────────────────────────────────────────────────────
  {
    componentId: 'adapter-dataforseo',
    type: 'adapter',
    name: 'DataForSEO 适配层（对外文案：Keyword Intelligence）',
    description:
      '关键词量 / KD / SERP / 外链数据源，CLAUDE.md 铁律 8 指定的搜索量与 KD 唯一合法来源之一。' +
      '不承载业务决策，只做数据获取与格式转换。',
    businessLanes: ['shared'],
    dapeStages: ['discovery', 'analysis'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: ['module-seo-content-engine'],
    sourcePaths: ['src/lib/dataforseo'],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: ['dataforseo:read'],
    evidence: [
      {
        kind: 'doc_reference',
        description:
          'docs/ENV.md：DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD 在 Render-web 已配置，标记「主数据源」',
        link: 'docs/ENV.md',
      },
      {
        kind: 'source_path',
        description: '6 个测试文件覆盖 client/serp/labs/business-data/business-listings',
        link: 'src/lib/dataforseo/__tests__',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M4',
    blockers: [],
  },

  // ── Agent ─────────────────────────────────────────────────────────────────
  {
    componentId: 'agent-huatuo',
    type: 'agent',
    name: '华佗（诊断 / 分析 Agent）',
    description:
      'DAPE 的 Analysis 段：拿数据 + AI 给六大支柱打分、说清为什么。只做推理，不直接执行或授权（CLAUDE.md DAPE 表）。',
    businessLanes: ['shared'],
    dapeStages: ['analysis'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/huatuo'],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'doc_reference',
        description: 'CLAUDE.md「核心引擎 = DAPE」表：华佗对应 Analysis 段后台 agent',
        link: 'CLAUDE.md',
      },
      {
        kind: 'doc_reference',
        description: 'docs/STATE.md §3：Agent 层标记「✅ 上线」，落表 diagnostic_{runs,findings,narratives}',
        link: 'docs/STATE.md',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M4',
    blockers: [],
  },

  // ── Playbook ──────────────────────────────────────────────────────────────
  {
    componentId: 'playbook-goal-to-action',
    type: 'playbook',
    name: 'Goal → Initiative → Action 策略编排',
    description:
      '把 Prescription 阶段的战略地图编排成可执行的 Action 序列，跨 lib/strategy、lib/marketing-plan、' +
      'lib/execution 三个能力协同，生产已上线。',
    businessLanes: ['shared'],
    dapeStages: ['prescription', 'execution'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/strategy', 'src/lib/marketing-plan', 'src/lib/execution'],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'doc_reference',
        description:
          'docs/STATE.md §3：策略层（Goal→Initiative→Action）标记「✅ 上线」，落表 goals / initiatives / ' +
          'marketing_plans / execution_items',
        link: 'docs/STATE.md',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M4',
    blockers: [],
  },

  // ── Registry ──────────────────────────────────────────────────────────────
  {
    componentId: 'me2-product-map-registry',
    type: 'registry',
    name: 'ME2 Product Map Registry',
    description:
      '本身：Module/Capability/Adapter/Agent/Playbook/Platform/Registry 七类组件的机器可读真源，' +
      '含 M0–M5 证据推导与只读 GitHub adapter。本条目记录 registry 自己的成熟度。',
    businessLanes: ['shared'],
    dapeStages: [],
    owners: ['me2-product-map-authors'],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/product-map'],
    issueNumbers: [974],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [
      {
        kind: 'issue',
        description: 'ME2 Product Map v1 — Dynamic GitHub-Synced Module / Capability Control Room',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/issues/974',
      },
      {
        kind: 'source_path',
        description: '本 PR 新增的 schema / 校验器 / M0–M5 引擎 / 只读 GitHub adapter / reconciliation 逻辑',
        link: 'src/lib/product-map',
      },
    ],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: false,
      hasTargetedTestsPassing: false,
      hasRealIntegrationEvidence: false,
      hasProductionRunEvidence: false,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M1',
    blockers: [
      {
        statement:
          '本次沙箱无 npm / 网络出站权限，`npm test` / `type-check` / `build` 未能本地跑通，' +
          'hasTargetedTestsPassing 暂记 false，等 CI 实跑后再由 PR2 更新这条种子数据',
        since: '2026-08-15',
      },
    ],
  },
]
