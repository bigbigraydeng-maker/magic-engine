/**
 * GET /api/clients/[id]/memory/list
 *
 * Phase 23.E — 一次性返回该客户的全部 L3 记忆四张表条目，供 FDE 浏览/编辑 UI 加载。
 *
 * 与 MemoryService.loadForClient 的区别：
 *   - 这里返回的是**完整行**（含 id / created_at / source / confidence_score / is_active 等）
 *   - 不做 has_content 聚合、不限 maxRecentDecisions、不过滤 minConfidence
 *   - 直接给前端做表格渲染用
 *
 * Responses:
 *   200  { preferences, proven_patterns, failed_experiments, decisions, counts }
 *   404  client not found（由 requirePaidClientAccess 处理）
 *   500  DB error
 *
 * Reference: ROADMAP.md Phase 23.E
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const [prefs, patterns, experiments, decisions] = await Promise.all([
      supabaseAdmin
        .from('client_learned_preferences')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('client_proven_patterns')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('client_failed_experiments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('client_decision_history')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    const preferences        = (prefs.data        ?? []) as Array<Record<string, unknown>>
    const proven_patterns    = (patterns.data     ?? []) as Array<Record<string, unknown>>
    const failed_experiments = (experiments.data  ?? []) as Array<Record<string, unknown>>
    const decision_history   = (decisions.data    ?? []) as Array<Record<string, unknown>>

    return NextResponse.json({
      success: true,
      preferences,
      proven_patterns,
      failed_experiments,
      decision_history,
      counts: {
        preferences:        preferences.length,
        proven_patterns:    proven_patterns.length,
        failed_experiments: failed_experiments.length,
        decision_history:   decision_history.length,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[memory/list] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
