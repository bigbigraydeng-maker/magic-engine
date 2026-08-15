/**
 * ME2 Product Map v1 —— 种子 registry 数据（Issue #974）。
 *
 * 🔴 **这里只登记稳定映射**：componentId、WP00 §3 的七层角色、代码路径、
 *    冻结契约路径、关联 Issue/PR、依赖与消费关系、风险级别、附属产物。
 *
 * 🔴 **这里不登记任何动态事实。** 没有 `maturity`、没有成熟度信号、没有四问快照 ——
 *    那些一律由 `../assessment.ts` 从 GitHub snapshot / 代码扫描 / 生产只读接口推导；
 *    PR1 还没接证据源，所以它们现在全是 `unknown`，**这是正确结果，不是缺陷**。
 *    上一版把这些手填成布尔值，Git 或生产一变就过期 —— 那正是本工具要取代的东西。
 *
 * 🔴 **`docs/**` 是 WP00 §2 的第 4 级证据，不能用来断言运行时事实。**
 *    上一版仅凭 `docs/STATE.md` 就把 SEO 内容引擎写成 M5、凭 `docs/ENV.md`
 *    把 DataForSEO 写成 M4 —— 两条都已删除。文档证据保留在 `evidence` 里作线索，
 *    但不再驱动任何成熟度判定。
 *
 * 🔴 `owners` 大量写着 `unassigned-pending-audit`：现有文档按模块记状态，不按组件记
 *    具体 owner。诚实标「未分配」比编一个名字更有用 —— 它本身就是该被看见的缺口。
 */

import type { RegistryComponent } from '../types'

const UNASSIGNED_OWNER = 'unassigned-pending-audit'

export const SEED_COMPONENTS: readonly RegistryComponent[] = [
  // ── kernel（WP00 §3.5）─────────────────────────────────────────────────────
  {
    componentId: 'me2-execution-kernel',
    architecturalRole: 'kernel',
    name: 'ME2 执行内核',
    description:
      '授权 / ActionKey 政策 / 幂等 / 租约与代际 fencing / 成本上限 / 审计 / lineage。' +
      '按 WP00 §3.5，它不做业务判断，也不对「该不该做」发表意见。',
    businessLanes: ['shared'],
    dapeStages: ['authorization', 'execution'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/kernel', 'src/lib/action-bridge'],
    contractSpecPaths: ['docs/specs/2026-08-08-me2-execution-kernel-v1.md'],
    issueNumbers: [882],
    pullRequestNumbers: [863, 898],
    riskLevel: 'A',
    requiredPermissions: [],
    supportingArtifacts: [],
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
    ],
    blockers: [
      {
        statement:
          '生产 migration 20260808000003_me2_execution_kernel_v1.sql 是否已 apply，必须由生产对象存在性探针回答；' +
          'apply 本身是单独授权的运维动作，必须 PM 显式 go，不许夹带进任何 PR',
        since: '2026-08-10',
      },
    ],
  },

  // ── measurement（WP00 §3.3）───────────────────────────────────────────────
  {
    componentId: 'me2-geo-measurement',
    architecturalRole: 'measurement',
    name: 'ME2 GEO 测量线',
    description:
      '采集身份与解释身份分离的 GEO 测量：契约 + 不可变存储 + 执行运行时 + provider/parser 接线。' +
      '按 WP00 §3.3，身份对不上时必须产出 not_comparable，不许降级成一个能比的数字。',
    businessLanes: ['geo'],
    dapeStages: ['discovery', 'verification'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/geo'],
    contractSpecPaths: ['docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md'],
    issueNumbers: [879],
    pullRequestNumbers: [],
    riskLevel: 'A',
    requiredPermissions: [],
    supportingArtifacts: [],
    evidence: [
      {
        kind: 'source_path',
        description: 'GEO 测量实现目录',
        link: 'src/lib/geo',
      },
      {
        kind: 'doc_reference',
        description: 'GEO 测量契约 v1.0（§3 采集/解释身份，§6 可比性三条判据）',
        link: 'docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md',
      },
    ],
    blockers: [],
  },

  // ── shared_capability（WP00 §3.4）─────────────────────────────────────────
  {
    componentId: 'me2-page-optimization',
    architecturalRole: 'shared_capability',
    name: 'ME2 页面优化共享能力',
    description:
      '把一份页面优化请求准备成可评审的具体改动，并在被授权之后写出去、能验证、能撤回。' +
      'provider write 只能存在于 src/lib/capabilities/** 之内；apply / rollback 只能经 Kernel。',
    businessLanes: ['shared'],
    dapeStages: ['prescription', 'execution', 'verification'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: ['me2-execution-kernel'],
    consumers: [],
    sourcePaths: ['src/lib/capabilities'],
    contractSpecPaths: ['docs/specs/2026-08-10-me2-page-optimization-capability-v1.0.md'],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'A',
    requiredPermissions: [],
    supportingArtifacts: [],
    evidence: [
      {
        kind: 'doc_reference',
        description: '页面优化共享能力契约 v1.0（§1.1 边界、§7 provider write 隔离由 eslint + 架构测试强制）',
        link: 'docs/specs/2026-08-10-me2-page-optimization-capability-v1.0.md',
      },
    ],
    blockers: [],
  },
  {
    componentId: 'me2-growth-contract',
    architecturalRole: 'shared_capability',
    name: 'ME2 Growth 契约',
    description:
      'observe → diagnose → prescribe → propose → verify 五段纯类型 + 纯校验器，供 Domain Module 共用。' +
      '⚠️ 角色归属待 #872 确认：它不产生 provider 写入，与 WP00 §3.4 的共享能力定义只部分吻合。',
    businessLanes: ['shared'],
    dapeStages: ['discovery', 'analysis', 'prescription'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/growth'],
    contractSpecPaths: [],
    issueNumbers: [877],
    pullRequestNumbers: [890],
    riskLevel: 'B',
    requiredPermissions: [],
    supportingArtifacts: [],
    evidence: [
      {
        kind: 'pull_request',
        description: 'Growth 契约 WP01 合并',
        link: 'https://github.com/bigbigraydeng-maker/magic-engine/pull/890',
      },
    ],
    blockers: [
      { statement: '等 WP05（GEO Module v1，#879）成为首个 Domain Module 消费方', since: '2026-08-10' },
      {
        statement:
          '七层角色归属未定：它是纯契约库，不写 provider，需回 #872 确认属于 shared_capability 还是 ' +
          'domain_module 的共享产物',
        since: '2026-08-15',
      },
    ],
  },

  // ── domain_module（WP00 §3.2）─────────────────────────────────────────────
  {
    componentId: 'module-seo-content-engine',
    architecturalRole: 'domain_module',
    name: 'SEO 内容引擎',
    description:
      'SEO 业务域：关键词研究、内容策略、站点审计、博客生产、GSC 回流。' +
      '按 WP00 §3.2，它产出的是候选，不能自我授权。',
    businessLanes: ['seo'],
    dapeStages: ['discovery', 'analysis', 'prescription', 'execution', 'outcome'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
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
    contractSpecPaths: [],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    supportingArtifacts: [
      {
        kind: 'provider_adapter',
        name: 'DataForSEO 适配层（对外文案：Keyword Intelligence）',
        description:
          '关键词量 / KD / SERP / 外链数据源。不承载业务决策，只做数据获取与格式转换。' +
          '⚠️ 是否真的被调用过必须由运行观测探针回答 —— 环境变量已配置不等于调用过。',
        sourcePaths: ['src/lib/dataforseo'],
        requiredPermissions: ['dataforseo:read'],
        evidence: [
          {
            kind: 'source_path',
            description: 'DataForSEO 适配层实现与测试目录',
            link: 'src/lib/dataforseo',
          },
        ],
      },
    ],
    evidence: [
      {
        kind: 'source_path',
        description: 'SEO 业务域实现目录（8 个）',
        link: 'src/lib/seo-intelligence',
      },
      {
        kind: 'doc_reference',
        description:
          'docs/STATE.md §3 标记「✅ 成熟」—— ⚠️ 仅为线索。docs 是 WP00 §2 第 4 级证据，' +
          '不用于任何成熟度判定；M5 需要重复且可归因的 outcome 证据，本条目前没有',
        link: 'docs/STATE.md',
      },
    ],
    blockers: [
      {
        statement:
          '缺 outcome identity / receipt / 生产数据行证据，成熟度无法超过「已查到的那一级」；' +
          '接上运行观测探针前一律 unknown',
        since: '2026-08-15',
      },
    ],
  },

  // ── agent（WP00 §3.1）─────────────────────────────────────────────────────
  {
    componentId: 'agent-huatuo',
    architecturalRole: 'agent',
    name: '华佗（诊断 / 分析 Agent）',
    description:
      'DAPE 的 Analysis 段：拿数据 + AI 给六大支柱打分、说清为什么。' +
      '按 WP00 §3.1，它只推理 —— 没有执行权、没有授权权、不能直接写库或写外部系统。',
    businessLanes: ['shared'],
    dapeStages: ['analysis'],
    owners: [UNASSIGNED_OWNER],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/huatuo'],
    contractSpecPaths: [],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    supportingArtifacts: [],
    evidence: [
      {
        kind: 'source_path',
        description: '华佗实现目录',
        link: 'src/lib/huatuo',
      },
    ],
    blockers: [],
  },
]
