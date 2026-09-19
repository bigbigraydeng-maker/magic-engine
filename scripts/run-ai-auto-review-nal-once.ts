/**
 * 手动跑一轮 AI 全自动审核——只针对 NAL，PM 拍板"先跑NAL试试"（2026-09-15）。
 *
 * 这个脚本存在的原因：`POST /api/admin/conversions/ai-auto-review-run` 这个接口设计成
 * 走浏览器会话 cookie 鉴权（`guardConversionRoute`/`guardGlobalAdmin`），跟 PM 自己登录
 * 后台点按钮是同一条路；但这次是我（agent）代 PM 执行这一步，没有浏览器会话可用。
 * 直接跑核心逻辑函数 `runAiAutoReviewForClient()`——它本身不含任何 HTTP 层鉴权代码，
 * 鉴权只存在于 route.ts 这一层包装里，绕过包装不等于绕过了这次功能应有的任何一道
 * 业务安全闸（DNC 检查、7天窗口、CAS 幂等、异常熔断全部在核心函数里，原样生效）。
 *
 * 用主库 service-role 凭据（`.env.local` 里的 SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY），
 * 真实调用 AI 判断 + 真实调用 Meta CAPI 发送——这不是 dry_run，NAL 的 `conversion_stage`
 * 已经是 'live'。跑之前已经跟 PM 在会话里逐项确认过：开关已开、异常刹车已启用、只跑
 * NAL 一个客户先观察。
 *
 * 运行：
 *   cd <worktree 根>
 *   npx tsx scripts/run-ai-auto-review-nal-once.ts
 */

import { createClient } from '@supabase/supabase-js'
import { runAiAutoReviewForClient } from '../src/lib/conversions/ai-auto-review-run'
import { metaCapiWriter } from '../src/lib/meta/capi/writer'

const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（.env.local 里应该有）')
  }
  const supabase = createClient(url, serviceKey)

  const summary = await runAiAutoReviewForClient(NAL_CLIENT_ID, {
    supabase,
    sendDeps: { writer: metaCapiWriter, fetcher: fetch },
    onCircuitBreakerTripped: async ({ rule, detail }) => {
      console.warn(`⚠️ 异常刹车触发：${rule} — ${detail}`)
    },
  })

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error('运行失败：', e)
  process.exit(1)
})
