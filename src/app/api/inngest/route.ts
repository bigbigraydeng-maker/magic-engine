/**
 * Magic Engine 2.0 · Inngest 接收端点（Issue #1346）—— 主应用「执行半边」的入口。
 *
 * 🔴 对外 endpoint。安全全压在 Inngest 的 `mode === cloud`（非 cloud 则签名校验整段跳过）。
 *    生产必须 NODE_ENV=production 且 INNGEST_DEV 未设真值。本端点在请求期加显式 fail-closed
 *    守卫（productionGuardError）：生产缺 signing key 或 INNGEST_DEV 真值 → 500 拒绝，不裸奔。
 *    守卫在请求期而非模块顶层，避免 build 期（无运行时密钥）误抛。
 *
 * 🔴 Next 路由文件只导出 GET/POST/PUT；cloudFunctions 与守卫判据在独立模块，供契约测试直测。
 */

import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { cloudFunctions } from '@/lib/inngest/functions'
import { productionGuardError } from '@/lib/inngest/serve-guard'

const handlers = serve({
  client: inngest,
  functions: cloudFunctions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
})

function guard(): Response | null {
  const err = productionGuardError({
    nodeEnv: process.env.NODE_ENV,
    signingKey: process.env.INNGEST_SIGNING_KEY,
    inngestDev: process.env.INNGEST_DEV,
  })
  return err
    ? new Response(JSON.stringify({ error: err }), { status: 500, headers: { 'content-type': 'application/json' } })
    : null
}

export async function GET(...args: Parameters<typeof handlers.GET>): Promise<Response> {
  return guard() ?? handlers.GET(...args)
}
export async function POST(...args: Parameters<typeof handlers.POST>): Promise<Response> {
  return guard() ?? handlers.POST(...args)
}
export async function PUT(...args: Parameters<typeof handlers.PUT>): Promise<Response> {
  return guard() ?? handlers.PUT(...args)
}
