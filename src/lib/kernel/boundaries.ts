/**
 * 架构边界的**唯一真相源**。
 *
 * ESLint 的规则（`.eslintrc.json`）和架构测试（`__tests__/architecture.test.ts`）
 * 都以这个文件为准，并且有一条测试专门盯着 `.eslintrc.json` 跟这里对不对得上 ——
 * 两处各写一份清单，早晚会分家，而「写侧和读侧口径分家」是这个仓库反复出事的形状。
 *
 * 为什么只管 provider write module，不管 `supabaseAdmin`（ADR-002 采纳）：
 *
 *   | 目标 | importer 数 |
 *   |---|---|
 *   | `supabaseAdmin` | 500+ |
 *   | 全部 provider write module 合计 | 34 |
 *
 * 「怎么避免一次打爆 500 多个 import」的答案是：**不去动那 500 多个**。
 * 真正会伤到客户的是对外写，而对外写的入口只有这 10 个模块。
 */

/**
 * 对外写能力模块 —— 只能被 `src/lib/capabilities/**` import。
 *
 * 判据是「这个模块会把东西发到客户自己的资产之外或改动客户的线上资产」：
 * 发帖、发布文章、改 meta、提交收录、改商家页。
 */
export const PROVIDER_WRITE_MODULES = [
  '@/lib/publer/client',
  '@/lib/cms/wordpress-client',
  '@/lib/cms/shopify-client',
  '@/lib/cms/github-client',
  '@/lib/cms/blog-publisher',
  '@/lib/cms/github-page-upgrade-publisher',
  '@/lib/cms/meta-patcher',
  '@/lib/gbp/publisher',
  '@/lib/gsc/indexing-client',
  '@/lib/gsc/sitemap-ping',
  // 🔴 K7（广告 IMPACT 闭环 · 阶段 2 · `~/.claude/plans/ads-impact-loop-capability.md`
  //    §14.1）：Meta 广告写入模块只准由 `src/lib/capabilities/**` 调用。
  //    现有调用方（stop-loss / draft-and-gate / execute route 等）进
  //    PROVIDER_WRITE_GRANDFATHERED 降级为 warn（只减不增）；新执行器只能
  //    落在 capabilities 目录下（PR-B/PR-C）。
  '@/lib/meta/client',
  '@/lib/meta/adsets',
  '@/lib/meta/ad-publisher',
  '@/lib/meta/audience-ladder',
] as const

/** 允许 import 上面这些模块的目录（新代码只能落在这里）。 */
export const PROVIDER_WRITE_ALLOWED_DIRS = ['src/lib/capabilities/'] as const

/**
 * 历史遗留的 importer —— **只准变短，不准变长**。
 *
 * 用精确路径而不是通配目录：这样任何**新文件**默认就撞规则，
 * 而清单只会随着逐个迁移而缩短。
 *
 * 🔴 往这个数组里加路径 = 又开了一个绕过执行内核的口子。加之前先问：
 *    这段代码能不能改成提交一个 action_run？
 */
export const PROVIDER_WRITE_GRANDFATHERED = [
  'src/app/api/clients/[id]/cms/github/update-page/route.ts',
  'src/app/api/clients/[id]/cms/publish-blog/route.ts',
  'src/app/api/clients/[id]/cms/publish-geo-snippet/route.ts',
  'src/app/api/clients/[id]/cms/publish-geo-to-github/route.ts',
  'src/app/api/clients/[id]/cms/publish-shopify/route.ts',
  'src/app/api/clients/[id]/cms/publish-wordpress/route.ts',
  'src/app/api/clients/[id]/cms/shopify/route.ts',
  'src/app/api/clients/[id]/cms/test/route.ts',
  'src/app/api/clients/[id]/cms/wordpress/lookup-post/route.ts',
  'src/app/api/clients/[id]/cms/wordpress/route.ts',
  'src/app/api/clients/[id]/cms/wordpress/test/route.ts',
  'src/app/api/clients/[id]/cms/wordpress/update-post/route.ts',
  'src/app/api/clients/[id]/cms/wordpress/yoast-probe/route.ts',
  'src/app/api/clients/[id]/gsc/index-request/route.ts',
  'src/app/api/clients/[id]/reels/[draftId]/publish/route.ts',
  'src/app/api/cms/github/webhook/route.ts',
  'src/app/api/cron/cms-connection-retest/route.ts',
  'src/app/api/publer/accounts/route.ts',
  'src/app/api/publer/create-post/route.ts',
  'src/app/api/publer/draft/[assetId]/route.ts',
  'src/app/api/publer/schedule/route.ts',
  'src/lib/blog/pr-sync.ts',
  'src/lib/cms/page-upgrade-pr-sync.ts',
  'src/lib/flywheel/social-post-publish.ts',
  'src/lib/luban/tools.ts',
  'src/lib/seo-meta/cts-meta-pr.ts',
  // 🔴 K7：以下是 `@/lib/meta/client` / `@/lib/meta/adsets` / `@/lib/meta/ad-publisher`
  //    现有的调用方（2026-09-15 实查 `grep -rl`）。`@/lib/meta/audience-ladder`
  //    当前无调用方（设计文档 §1.1 已核实），不加豁免——它的第一个真实调用方
  //    必须走 capabilities 层。
  'src/app/api/clients/[id]/ad-health/stop-loss/route.ts',
  'src/app/api/clients/[id]/meta-ads/boost-post/route.ts',
  'src/app/api/clients/[id]/meta-ads/execute/route.ts',
  'src/app/api/clients/[id]/meta-ads/sync/route.ts',
  'src/app/api/cron/google-data-pullback-daily/route.ts',
  'src/lib/ads-strategy/daily-insights.ts',
  'src/lib/ads-strategy/stop-loss.ts',
  'src/lib/ads-strategy/draft-and-gate.ts',
] as const

/**
 * 现在直接写 `execution_items` 的 15 个生产者 —— 同样**只准变短**。
 *
 * `execution_items` 继续是**人看的意图卡 / 看板**，不是执行引擎（ADR-001）。
 * 新的执行路径应该提交 `action_run`，而不是往看板上再插一行然后自己去做。
 */
export const EXECUTION_ITEMS_WRITERS_GRANDFATHERED = [
  'src/app/api/clients/[id]/ai-factory/fan-out/route.ts',
  'src/app/api/clients/[id]/execution/[itemId]/route.ts',
  'src/app/api/clients/[id]/execution/manual/route.ts',
  'src/app/api/clients/[id]/execution/route.ts',
  'src/app/api/clients/[id]/social-plan/[planId]/save-to-board/route.ts',
  'src/app/api/initiatives/[id]/bulk-assign/route.ts',
  'src/lib/diagnostic/execution-generator.ts',
  'src/lib/diagnostic/prescription-landing.ts',
  'src/lib/execution/auto-run.ts',
  'src/lib/factory/publish/publish-worker.ts',
  'src/lib/luban/project-tools.ts',
  'src/lib/marketing-plan/task-dispatcher.ts',
  'src/lib/zhuge/action-persister.ts',
  'src/lib/zhuge/card-expiry.ts',
  'src/lib/zhuge/proactive.ts',
] as const

/**
 * 全仓唯一允许把普通对象抬成 `AuthorizedExecutionContext` 的文件。
 *
 * 编译期的 brand 挡的是「忘了授权」；这条规则挡的是「故意规避」——
 * `as unknown as AuthorizedExecutionContext` 是一行显式写下的绕过代码，
 * ESLint 关得掉，架构测试关不掉。
 */
export const AUTHORIZED_CONTEXT_MINTERS = ['src/lib/kernel/authorize.ts'] as const

/** Kernel 内部不许直连 supabaseAdmin —— 客户端一律由调用方注入。 */
export const KERNEL_NO_SUPABASE_ADMIN_DIRS = ['src/lib/kernel/', 'src/lib/capabilities/'] as const

/**
 * 🔴 **Kernel 不许 import 任何域模块，也不许 import bridge。**
 *
 * 依赖方向只有一条：`bridge → kernel`。反过来（把候选身份映射放进 Kernel）
 * 会逼着 Kernel **每接一个新域就多 import 一个域模块** —— 治权的那一层
 * 反而挂在被治理的那些层上，第二个域模块进来时就会看出这条路走不通。
 *
 * 候选身份靠**结构**匹配（bridge 自己声明 `CandidateIdentity`），
 * 所以三方谁都不用 import 谁：Growth 不 import Kernel，Kernel 不 import 两者。
 */
export const KERNEL_FORBIDDEN_MODULE_IMPORTS = [
  '@/lib/growth',
  '@/lib/action-bridge',
] as const

/**
 * bridge 只准依赖 Kernel 的类型与只读注册表。
 *
 * 它是一层**纯映射**：不碰库、不碰 provider、不碰执行、不碰 legacy 生成端。
 * 一旦这里能 import 到 capabilities 或 supabase，它就从「翻译」变成了
 * 第二条执行路径 —— 那正是 ME2 只留一个入口（提交 action_run）要防的事。
 */
export const ACTION_BRIDGE_FORBIDDEN_IMPORTS = [
  '@/lib/growth',
  '@/lib/capabilities',
  '@/lib/supabase',
  '@supabase/supabase-js',
  '@/lib/execution',
  '@/lib/zhuge',
  '@/lib/cms/',
  '@/lib/publer/',
  '@/lib/gbp/',
  '@/lib/gsc/',
] as const

/**
 * `src/lib/action-submission/**` —— PageOptimizationRequest → Kernel 的**平台级
 * submission adapter**。它的职责就一条：接一份 request + 一个 candidate identity，
 * 走 bridge 拿 ActionKey，走 Kernel 的 `runAction` 交付。禁止清单跟 bridge 类似，
 * 但**允许** import Kernel 与 bridge（这正是它的工作），只**禁止**：
 *
 * 🔴 capability / provider-write —— 它不是执行方，是提交方。
 * 🔴 直连 supabase 客户端 —— 数据访问一律走注入进来的 `KernelDeps`。
 * 🔴 域模块（`@/lib/growth`, `@/lib/geo-module`）—— 把 GEO 语义写进 shared
 *    submission runtime 就把它绑死在首个域了；下一次接第二个域会需要它再 import
 *    一次，跟 Kernel 不许 import 域是同一个理由。触发端（trigger script）可以自由
 *    import 域模块把 `CandidateIdentity` 传进来 —— 但 shared caller 自己不 import。
 * 🔴 legacy 执行路径（`@/lib/execution`, `@/lib/zhuge`）—— 不该有第二条 submit path。
 * 🔴 page-optimization 除了 type 之外的实现（`@/lib/page-optimization/draft` / diff /
 *    validate / resolve / snapshot）—— caller 不重跑 WP06 pipeline，只接受结果。
 *    只允许 type-only import：`@/lib/page-optimization`（顶级 barrel）与
 *    `@/lib/page-optimization/types`。子路径运行时 import 都算绕过。
 */
export const ACTION_SUBMISSION_FORBIDDEN_IMPORTS = [
  '@/lib/capabilities',
  '@/lib/supabase',
  '@supabase/supabase-js',
  '@/lib/execution',
  '@/lib/zhuge',
  '@/lib/growth',
  '@/lib/geo-module',
  '@/lib/cms/',
  '@/lib/publer/',
  '@/lib/gbp/',
  '@/lib/gsc/',
  '@/lib/page-optimization/draft',
  '@/lib/page-optimization/diff',
  '@/lib/page-optimization/validate',
  '@/lib/page-optimization/resolve',
] as const

/**
 * Kernel progression API 的调用面。
 *
 * `runAction` / `submitActionRun` / `approveAndRun` / `rejectPendingRun` /
 * `resumeDeadLetterRun` / `recoverDeniedRun` 是 Kernel 对外**仅有**的几个进
 * 状态机的入口（runner.ts §注释）。为了防止将来又冒出"直接 import 一下就自己
 * submit"的第二条路径，这里锁死**只有**下面这些目录能在生产代码里 import 它们：
 *   · Kernel 自己（内部互相调用）
 *   · `src/lib/action-submission/**`（本轮新增的平台级 caller）
 *   · `src/lib/kernel-approval/**`（人点头之后的授权路径，见现有代码）
 *
 * 🔴 这条闸只管 runtime code（walker 排除 tests / __tests__ 目录 —— tests 需要
 *    直接调 Kernel 来验证 progression 语义，那是正当用途）。
 *
 * 🔴 新增一条 caller = 拆一次架构评审（改 boundaries.ts 就是一次要过 review 的
 *    diff），不是随便加。加之前先问：现有 caller 能不能承载？
 */
export const KERNEL_RUNNER_ALLOWED_CALLER_DIRS = [
  'src/lib/kernel/',
  'src/lib/action-submission/',
  'src/lib/kernel-approval/',
] as const

/**
 * 🔴 **哪些模块暴露 progression 符号**。两条都要看：
 *
 *    · `@/lib/kernel/runner` —— 定义地
 *    · `@/lib/kernel`        —— barrel re-export（见 kernel/index.ts）
 *
 *    只盯 runner 会漏 barrel bypass：`import { runAction } from '@/lib/kernel'`
 *    完全绕过一条"只 ban 了 runner 路径"的规则。所以两条都进闸。
 *
 * 🔴 **不 ban 整个 barrel** —— `@/lib/kernel` 还导出类型、`createKernel`、
 *    `ACTION_REGISTRY` 之类的合法东西。判据是**符号级**：只有
 *    `KERNEL_RUNNER_SYMBOLS` 里的名字在这两条路径下被具名导入时才算违规。
 *    type-only imports 不算（拿签名类型不能真调 progression）。
 */
export const KERNEL_RUNNER_SOURCE_MODULES = ['@/lib/kernel/runner', '@/lib/kernel'] as const

/**
 * 🔴 **Kernel progression 符号清单**。只列真能推 run 状态的东西，不列类型
 *    （`SubmitActionInput` / `ActionRunOutcome` 等）—— 那些是形状描述，
 *    不是执行入口。
 *
 * 🔴 加一个新的 progression 入口（例如未来的 `resumeXxx`）必须回到这里显式加名，
 *    否则新入口不会被这道闸覆盖。这条 boundary 的默认答案是"不许"，
 *    穷举白名单而不是黑名单否定，同一个仓库反复踩过的坑。
 */
export const KERNEL_RUNNER_SYMBOLS = [
  'runAction',
  'submitActionRun',
  'approveAndRun',
  'rejectPendingRun',
  'resumeDeadLetterRun',
  'recoverDeniedRun',
] as const

/**
 * `supabase/migrations` 里**已经存在**的重复版本号 —— 同样只准变短。
 *
 * 🔴 这不是新问题，是查出来的旧账：`origin/main` 上已经有 **23 组**不同文件
 *    共用同一个 14 位版本号（多的一组有 3 个文件）。成因就是并行开发 ——
 *    两个窗口各自起了一个 migration，各自分支上都看不出撞车，合并后才重复。
 *    这次 Kernel 自己也差点撞上（原本用 20260808000001，而 PR #862 已经占了
 *    000001 / 000002），所以把这条查重做成 CI 门槛。
 *
 * 存量不在本 PR 修（改已 apply 过的 migration 文件名会打乱生产上的账本，
 * 那是一次需要单独评估的运维动作）。这里只保证**不再新增**。
 *
 * ⚠️ 往这个清单里加版本号 = 又放进一次撞车。加之前先把自己的文件改个号。
 */
export const MIGRATION_VERSION_COLLISIONS_GRANDFATHERED = [
  '20260501000008',
  '20260507000001',
  '20260522000001',
  '20260523000001',
  '20260530000001',
  '20260601000002',
  '20260602000001',
  '20260603000001',
  '20260611000001',
  '20260617000001',
  '20260619000001',
  '20260623000001',
  '20260624000001',
  '20260624000002',
  '20260626000001',
  '20260626000002',
  '20260628000001',
  '20260715000001',
  '20260728000001',
  '20260731100000',
  '20260801120000',
  '20260801150000',
  '20260803140000',
] as const
