/**
 * Render 部署后，新进程用现成的 PUT /api/inngest 把自己的函数登记上去。
 * 登记仍走接收端点里的那次注册，用的是已经配好的签名密钥。不新增密钥，不新开服务。
 * 本地、构建期、预览站不登记。
 */

import { NextRequest } from 'next/server'
import { productionGuardError } from './serve-guard'

/** 半分钟后再登记，好让进程先听端口。启动本身不等这次登记。 */
export const INNGEST_BOOT_SYNC_DELAY_MS = 30_000

/** 与后台入口同一个站点。登记时告诉 Inngest 回调这个地址。 */
export const INNGEST_SERVE_URL = 'https://app.magicengine.com.au/api/inngest'

export interface InngestBootEnv {
  NODE_ENV?: string
  NEXT_PHASE?: string
  NEXT_RUNTIME?: string
  RENDER?: string
  IS_PULL_REQUEST?: string
  INNGEST_SIGNING_KEY?: string
  INNGEST_DEV?: string
}

type PutFn = (req: NextRequest) => Promise<Response>

let scheduled = false

export function shouldSyncInngestOnBoot(env: InngestBootEnv): boolean {
  if (env.NEXT_RUNTIME === 'edge') return false
  if (env.NEXT_PHASE === 'phase-production-build') return false
  if (env.RENDER !== 'true') return false
  if (env.IS_PULL_REQUEST === 'true') return false
  if (env.NODE_ENV !== 'production') return false
  return productionGuardError({
    nodeEnv: env.NODE_ENV,
    signingKey: env.INNGEST_SIGNING_KEY,
    inngestDev: env.INNGEST_DEV,
  }) === null
}

export function resetInngestBootSyncForTests(): void {
  scheduled = false
}

async function putServe(req: NextRequest): Promise<Response> {
  const { PUT } = await import('@/app/api/inngest/route')
  return PUT(req, undefined)
}

export async function syncInngestOnBoot(
  env: InngestBootEnv,
  put: PutFn = putServe,
): Promise<{ ran: boolean; status: number | null }> {
  if (!shouldSyncInngestOnBoot(env)) return { ran: false, status: null }
  const response = await put(new NextRequest(INNGEST_SERVE_URL, { method: 'PUT' }))
  return { ran: true, status: response.status }
}

export function logSyncStatus(status: number | null): void {
  if (status === null || (status >= 200 && status < 300)) return
  console.error(`inngest boot sync failed: HTTP ${status}`)
}

function logSyncFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : 'unknown'
  console.error(`inngest boot sync failed: ${message}`)
}

export function scheduleInngestSyncOnBoot(
  env: InngestBootEnv,
  deps: { put?: PutFn; later?: (run: () => void) => void } = {},
): boolean {
  if (scheduled || !shouldSyncInngestOnBoot(env)) return false
  scheduled = true
  const run = () => {
    void syncInngestOnBoot(env, deps.put)
      .then((result) => logSyncStatus(result.status))
      .catch(logSyncFailure)
  }
  if (deps.later) deps.later(run)
  else {
    const timer = setTimeout(run, INNGEST_BOOT_SYNC_DELAY_MS)
    timer.unref()
  }
  return true
}
