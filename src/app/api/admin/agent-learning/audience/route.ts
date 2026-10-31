/**
 * POST /api/admin/agent-learning/audience
 * { lessonKey, mode: 'all' | 'off' | 'one', clientId? }
 *
 * Turns a lesson on for every client, off, or on for exactly one client.
 * One-client mode writes evidence.pilot_client_ids and does not change any
 * other client. Global admin only. Does not spend, publish, or call an ad platform.
 */
import { NextRequest, NextResponse } from 'next/server'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { applyLessonAudience, type AudienceMode } from '@/lib/agent-learning/lesson-audience'
import { supabaseAudienceStore } from '@/lib/agent-learning/lesson-audience-db'

function isMode(value: unknown): value is AudienceMode {
  return value === 'all' || value === 'off' || value === 'one'
}

async function readBody(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false as const, error: '请求格式不对' }
  }
  const record = body as Record<string, unknown>
  if (typeof record.lessonKey !== 'string' || record.lessonKey.trim() === '') {
    return { ok: false as const, error: '缺少经验' }
  }
  if (!isMode(record.mode)) return { ok: false as const, error: '不知道要开给谁' }
  const clientId = typeof record.clientId === 'string' ? record.clientId : undefined
  return {
    ok: true as const,
    value: { lessonKey: record.lessonKey.trim(), mode: record.mode, clientId },
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const parsed = await readBody(req)
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })

  const result = await applyLessonAudience(supabaseAudienceStore(), parsed.value)
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })

  return NextResponse.json({
    success: true,
    lesson: { is_active: result.isActive, audience: result.audience },
  })
}
