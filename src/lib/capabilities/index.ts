/**
 * Capability 层 —— 真正去做事的那一层。
 *
 * 🔴 **这一层的函数只能被 `lib/kernel/gateway.ts` 调用。**
 *    每个处理器的第一个入参都带着 `AuthorizedExecutionContext`，
 *    而那个类型只有 `lib/kernel/authorize.ts` 造得出来。
 *    「拿到一个 supabase 客户端就能写」在这一层不成立。
 *
 * 🔴 未来所有**对外写**的 provider 模块（wordpress / gbp / indexing …）
 *    只能在这个目录下被 import。ESLint 的 no-restricted-imports 和
 *    `kernel/__tests__/architecture.test.ts` 两道一起管着这条边界，
 *    后者关不掉（`// eslint-disable` 对它无效）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapabilityImplementation } from '@/lib/kernel/types'
import { createBuildPublishPackageCapability } from './seo/build-publish-package'
import { createPageApplyOptimizationCapability } from './page-apply-optimization'
import { createAdsAutoPauseCapability } from './ads-auto-pause'
import { createPauseUnitCapability } from './ads/pause-unit'
import { createPauseCampaignCapability } from './ads/pause-campaign'
import { createCutUnitBudgetCapability } from './ads/cut-unit-budget'
import { createCutCampaignBudgetCapability } from './ads/cut-campaign-budget'
import { createScaleUnitBudgetCapability } from './ads/scale-unit-budget'
import {
  createAddRetargetingAdsetCapability,
  createBudgetMovePlanCapability,
  createSwapCreativeCapability,
} from './ads/deferred-to-human'

/**
 * 装配这个进程能执行的全部能力。
 *
 * 用工厂而不是模块级常量，是因为每个 capability 都需要一个注入进来的
 * supabase 客户端 —— 让它自己去 import `supabaseAdmin` 就等于给了
 * 「绕过 Kernel 直接写」一条现成的路。
 */
export function createCapabilities(
  sb: SupabaseClient,
): Readonly<Record<string, CapabilityImplementation>> {
  return {
    'seo.build_publish_package': createBuildPublishPackageCapability(sb),
    // Page Optimization Apply v1 —— GitHub Draft PR path.
    // spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md
    'page.apply_optimization_request': createPageApplyOptimizationCapability(sb),
    // 广告 D3 自动暂停 v1 —— 不需要 supabase（纯 Meta API 读写）。
    'ads.auto_pause_on_d3': createAdsAutoPauseCapability(),
    // 广告支柱受限自治六件（spec 2026-09-24 §3 G4/G5）。
    // pause / cut / scale 三件已真实实现；剩余三件跨多对象暂 stub 转人工。
    'ads.pause_unit':             createPauseUnitCapability(sb),
    'ads.pause_campaign':         createPauseCampaignCapability(sb),
    'ads.cut_unit_budget':        createCutUnitBudgetCapability(sb),
    'ads.cut_campaign_budget':    createCutCampaignBudgetCapability(sb),
    'ads.scale_unit_budget':      createScaleUnitBudgetCapability(sb),
    'ads.budget_move_plan':       createBudgetMovePlanCapability(sb),
    'ads.add_retargeting_adset':  createAddRetargetingAdsetCapability(sb),
    'ads.swap_creative':          createSwapCreativeCapability(sb),
  }
}

export {
  prepareBuildPublishPackageInput,
  computeBlogContentHash,
  KERNEL_PRODUCER,
  KERNEL_PACKAGE_STATUS,
} from './seo/build-publish-package'
