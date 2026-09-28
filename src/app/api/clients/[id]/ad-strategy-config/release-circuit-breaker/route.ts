/**
 * POST /api/clients/[id]/ad-strategy-config/release-circuit-breaker
 *
 * 解除熔断器自动设的 deny——把该客户全部 `ads.*` 动作的
 * `client_automation_policies.mode` 从 `deny` 解回 `require_approval`
 * （WP3 熔断器运行时调用方）。
 *
 * 只解熔断器自己写的 deny：唯一写入口 `ads_release_circuit_breaker_policy`
 * 本身只认 `updated_by` 前缀 `circuit-breaker:`，管理员手动设的 deny 这条
 * 路由碰不到。
 *
 * 解到 `require_approval` 而不是 `auto_approve`——解除只是把安全阀放回
 * "需要人批"，不替 PM 决定恢复全自动；PM 要恢复 `bounded_auto` 得自己在
 * 这个页面再拨一次自治模式，那条路径走已有的 PATCH（会重新发
 * `ads_sync_autonomy_policy`）。
 *
 * 全局 admin 闸：跟 PATCH ad-strategy-config 同一理由——这是内部控制项，
 * 客户成员不能自己解除熔断。`updated_by` 由 `requireGlobalAdmin` 的 email 拼，
 * 不从 body 读（body 里给身份等于让调用方自报）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'

export const dynamic = 'force-dynamic'

export interface ReleaseKeyResult {
  readonly key: string
  readonly outcome: string // rpc 返回：released | not_circuit_tripped | no_policy_row | race_lost
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const staff = await requireGlobalAdmin()
  if (!staff.ok) return NextResponse.json({ error: staff.error }, { status: staff.status })
  const updatedBy = `circuit-breaker-release:${staff.user.email ?? 'unknown'}:${new Date().toISOString()}`

  const results: ReleaseKeyResult[] = []
  for (const key of listAdsActionKeys()) {
    const { data, error } = await supabaseAdmin.rpc('ads_release_circuit_breaker_policy', {
      p_client_id: clientId,
      p_action_key: key,
      p_updated_by: updatedBy,
    })
    if (error) {
      return NextResponse.json(
        { error: `ads_release_circuit_breaker_policy(${key}) failed: ${error.message}` },
        { status: 500 },
      )
    }
    results.push({ key, outcome: typeof data === 'string' ? data : 'unknown' })
  }

  const released = results.filter(r => r.outcome === 'released').length
  return NextResponse.json({ success: true, released, results })
}
