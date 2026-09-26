/**
 * 广告支柱的 Kernel 依赖包装配（WP3.1b）。
 *
 * 为什么放在 capability 层而不是 `src/lib/ads-strategy/`：
 *   装配「谁来真正执行」这件事属于执行层。提交方（`ads-strategy/stop-loss-submission.ts`）
 *   只负责构造 `SubmitActionInput` 并调 Kernel；它不该知道 capability 实现长什么样，
 *   也不该 import capability 层。
 *
 * 🔴 `capabilities` 给的是**真实**实现，不是空表。
 *    对比 `kernel-approval/service.ts` 刻意给空表（那一层只签授权、不执行）——
 *    这里相反：客户策略是 `auto_approve` 且这次改动在信封内时，Kernel 会**继续往下执行**，
 *    空表会让它停在 `CAPABILITY_NOT_IMPLEMENTED`，一个「看着接好了其实是死的」按钮。
 *
 * 🔴 `resolveEnvelopeFacts` 必须给。六个广告动作都声明 `approval: { mode: 'bounded' }`，
 *    缺这个解析器时 authorize / gateway 会**一律拒**（见 `kernel/deps.ts` 注释）——
 *    那同样是「功能上线了其实是死的」。
 *
 * 🔴 supabase 客户端由调用方注入，本文件不 import `supabaseAdmin`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createKernelDeps, type KernelDeps } from '@/lib/kernel/deps'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createCapabilities } from './index'
import { createAdsEnvelopeFactsResolver } from './ads/envelope-facts'

/** 装一份能真正执行广告动作的 Kernel 依赖包。 */
export function createAdsKernelDeps(sb: SupabaseClient): KernelDeps {
  const capabilities = createCapabilities(sb)
  return createKernelDeps({
    supabase: sb,
    registry: ACTION_REGISTRY,
    capabilities,
    workerId: `ads-kernel@${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
    // 信封事实的来源跟能力表用同一份 capabilities —— 判「这个动作有没有注册撤回
    // 处理函数」要查的就是它，两处给不同的表会让判据跟实际执行的东西对不上。
    resolveEnvelopeFacts: createAdsEnvelopeFactsResolver({ sb, capabilities }),
  })
}
