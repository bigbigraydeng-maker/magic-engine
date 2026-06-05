/**
 * GET /api/clients/[id]/memory/export
 *
 * Phase 23.E — 导出该客户全部 L3 记忆为 JSON 文件，供 FDE 备份 / 客户交付 / 离线分析。
 *
 * Query params (optional):
 *   download=1 — Content-Disposition: attachment, 触发浏览器下载
 *
 * Response 200 (JSON body):
 *   {
 *     client_id, exported_at, version: 1,
 *     preferences, proven_patterns, failed_experiments, decision_history
 *   }
 *
 * Reference: ROADMAP.md Phase 23.E
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(req.url)
  const asDownload = searchParams.get('download') === '1'

  try {
    const [prefs, patterns, experiments, decisions] = await Promise.all([
      supabaseAdmin
        .from('client_learned_preferences')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('client_proven_patterns')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('client_failed_experiments')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('client_decision_history')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: true }),
    ])

    const payload = {
      version: 1 as const,
      client_id: clientId,
      exported_at: new Date().toISOString(),
      preferences:        prefs.data        ?? [],
      proven_patterns:    patterns.data     ?? [],
      failed_experiments: experiments.data  ?? [],
      decision_history:   decisions.data    ?? [],
    }

    const json = JSON.stringify(payload, null, 2)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
    }
    if (asDownload) {
      const fname = `memory-${clientId}-${new Date().toISOString().slice(0, 10)}.json`
      headers['Content-Disposition'] = `attachment; filename="${fname}"`
    }

    return new NextResponse(json, { status: 200, headers })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[memory/export] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
