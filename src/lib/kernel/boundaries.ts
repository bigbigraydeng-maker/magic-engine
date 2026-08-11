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
