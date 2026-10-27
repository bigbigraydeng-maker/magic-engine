/**
 * POST /api/admin/agent-learning/backtest  { lessonKey, clientId }
 * 只读：按经验文字自动匹配回测规则，读该客户近 90 天 ad_daily_insights 现算。
 * 不调模型、不写库、不碰广告账户；只收经验 key 和客户 id。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import {
  BACKTEST_DAYS, classifyBacktest, describeBacktest, runBacktest, type InsightRow,
} from '@/lib/agent-learning/lesson-verify/backtest'

const HOURLY_LIMIT = 30
const hits: number[] = []

/** 每实例每小时 30 次（内存计数，多实例下是近似值）。 */
function overLimit(now: number): boolean {
  while (hits.length && now - hits[0] > 3_600_000) hits.shift()
  if (hits.length >= HOURLY_LIMIT) return true
  hits.push(now)
  return false
}

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard
  if (overLimit(Date.now())) {
    return NextResponse.json({ success: false, error: '回测次数太多，请稍后再试' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as { lessonKey?: unknown; clientId?: unknown }
  if (typeof body.lessonKey !== 'string' || !body.lessonKey || typeof body.clientId !== 'string' || !body.clientId) {
    return NextResponse.json({ success: false, error: 'lessonKey and clientId required' }, { status: 400 })
  }
  const { data: lesson } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson, rationale')
    .eq('lesson_key', body.lessonKey)
    .maybeSingle()
  if (!lesson) return NextResponse.json({ success: false, error: 'lesson not found' }, { status: 404 })

  const rule = classifyBacktest(lesson.lesson as string, lesson.rationale as string | null)
  if (!rule) return NextResponse.json({ success: true, backtestable: false, summary: '无法回测：这条经验没有对应的可计算指标。' })

  const since = new Date(Date.now() - BACKTEST_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('frequency, cpm, ctr, impressions')
    .eq('client_id', body.clientId)
    .eq('platform', 'meta')
    .eq('level', 'campaign')
    .gte('insight_date', since)
    .limit(5000)
  if (error) return NextResponse.json({ success: false, error: '读取广告数据失败，请稍后再试' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ success: true, backtestable: false, summary: '无法回测：该客户没有广告数据。' })

  const result = runBacktest(rule, data as InsightRow[])
  return NextResponse.json({ success: true, backtestable: true, verdict: result.verdict, summary: describeBacktest(result) })
}
