/**
 * Team Working Memory — 上报接口鉴权
 *
 * 复用 CRON_SECRET，而不是新造一个 env：
 * PM 的全局 Claude Code 设置里已经有 ME_CRON_SECRET，hook 直接就能用，
 * 不需要他再去 Render 配一遍。少一个「要 PM 手工配」的步骤，就少一处静默失效。
 * （前车之鉴：daily-cron-digest 因为 cron 密钥没自动填，哑了 51 天没人发现。）
 */

import { NextResponse } from 'next/server'

export interface AuthFailure {
  response: NextResponse
}

/** 通过返回 null；不通过返回要直接 return 的响应。 */
export function checkHookAuth(authHeader: string | null): AuthFailure | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return {
      response: NextResponse.json(
        { error: '服务端未配置 CRON_SECRET' },
        { status: 500 },
      ),
    }
  }
  if (authHeader !== `Bearer ${secret}`) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return null
}
