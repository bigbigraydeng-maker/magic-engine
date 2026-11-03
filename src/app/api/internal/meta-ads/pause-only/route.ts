/**
 * POST /api/internal/meta-ads/pause-only
 *
 * 服务级只暂停。不是定时任务（不在 /api/cron，定时覆盖检查不会把它当成漏配的任务）。
 * 鉴权只用服务密钥，不认登录会话。总开关 ME_SERVICE_PAUSE_ENABLED 默认关。
 * 只能暂停，不能恢复、改预算、删除或新建。
 */

import { NextRequest } from 'next/server'
import { handlePauseOnlyRequest, realPauseDeps } from '@/lib/meta/service-pause-only'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return handlePauseOnlyRequest(req, realPauseDeps(), process.env.CRON_SECRET)
}
