// P21.J M1 — POST /api/factory/signals
// 信号入口(spec §3.3):CTS Meta Ads 工作流(或内部自发)push 信号 → 落库 → 同步评估。
// 鉴权:Bearer INTERNAL_API_KEY。dedupe_key 撞唯一索引 = 幂等重发,返回既有信号。

import { NextRequest, NextResponse } from 'next/server'
import { evaluateSignal } from '@/lib/factory/evaluate'
import { supabaseAdmin } from '@/lib/supabase'
import type { SignalType } from '@/lib/factory/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIGNAL_TYPES: SignalType[] = ['creative_fatigue', 'scale_winner', 'new_campaign', 'asset_gap']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** evidence/request 必须是 plain object,数组/字符串入 jsonb 会让护栏 11 静默失效(魏征 M1-F10) */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function POST(req: NextRequest) {
  const key = process.env.INTERNAL_API_KEY
  const auth = req.headers.get('authorization')
  // fail-closed:env 未配置一律 401,不放行
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  const signalType = body.signal_type as SignalType
  if (!UUID_RE.test(clientId)) {
    return NextResponse.json({ error: 'client_id must be a uuid' }, { status: 400 })
  }
  if (!SIGNAL_TYPES.includes(signalType)) {
    return NextResponse.json(
      { error: `signal_type must be one of ${SIGNAL_TYPES.join('|')}` },
      { status: 400 },
    )
  }
  if (body.evidence !== undefined && !isPlainObject(body.evidence)) {
    return NextResponse.json({ error: 'evidence must be an object' }, { status: 400 })
  }
  if (body.request !== undefined && !isPlainObject(body.request)) {
    return NextResponse.json({ error: 'request must be an object' }, { status: 400 })
  }

  const row = {
    client_id: clientId,
    signal_type: signalType,
    source: typeof body.source === 'string' ? body.source : 'cts-meta-ads-operator',
    dedupe_key: typeof body.dedupe_key === 'string' ? body.dedupe_key : null,
    confidence: typeof body.confidence === 'number' ? body.confidence : null,
    evidence: (body.evidence ?? {}) as Record<string, unknown>,
    request: (body.request ?? {}) as Record<string, unknown>,
    expires_at: typeof body.expires_at === 'string' ? body.expires_at : null,
  }

  const { data: signal, error } = await supabaseAdmin
    .from('content_demand_signals')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    // 唯一索引冲突 = 同 dedupe_key 幂等重发(魏征 F6 字符串层),返回既有信号
    if (error.code === '23505' && row.dedupe_key) {
      const { data: existing } = await supabaseAdmin
        .from('content_demand_signals')
        .select('id, status, reject_reason, work_order_id')
        .eq('dedupe_key', row.dedupe_key)
        .maybeSingle()
      return NextResponse.json({ deduped: true, signal: existing }, { status: 200 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 同步评估(M1;sweeper cron 兜底属 M2)。评估内部 fail-closed,自身异常不 500。
  const result = await evaluateSignal(signal.id)

  return NextResponse.json({ signal_id: signal.id, ...result }, { status: 201 })
}
