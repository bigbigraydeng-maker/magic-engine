/**
 * POST /api/internal/meta-ads/pause-only
 *
 * 服务级只暂停。不是定时任务（不在 /api/cron，定时覆盖检查不会把它当成漏配的任务）。
 * 鉴权只用服务密钥，不认登录会话。总开关 ME_SERVICE_PAUSE_ENABLED 默认关。
 * 服务身份只出暂停确认卡，不暂停。人点未过期的卡之后才改系列。
 */

import { NextRequest } from 'next/server'
import { handlePauseOnlyRequest, realPauseDeps } from '@/lib/meta/service-pause-only'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return handlePauseOnlyRequest(req, realPauseDeps(), process.env.CRON_SECRET)
}
