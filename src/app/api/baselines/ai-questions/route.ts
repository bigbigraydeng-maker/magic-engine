/**
 * GET  /api/baselines/ai-questions          — list questions (optional ?industry=)
 * POST /api/baselines/ai-questions          — add a new question (admin only)
 *
 * Admin-only (guardAdmin). Powers the "AI 可见度" tab on /dashboard/industry-baselines.
 */

import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

export async function GET(req: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const industry = searchParams.get('industry')
  const activeOnly = searchParams.get('active_only') !== 'false'

  let query = supabaseAdmin
    .from('industry_ai_visibility_questions')
    .select('*')
    .order('industry_code')
    .order('country', { nullsFirst: false })
    .order('language')

  if (industry)   query = query.eq('industry_code', industry)
  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ questions: data ?? [] })
}

export async function POST(req: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const body = await req.json() as {
    industry_code: string
    intent_layer: string
    geo_scope: 'national' | 'city'
    country?: string | null
    city?: string | null
    language: 'en' | 'zh'
    question_text: string
    platforms?: string[]
    notes?: string | null
  }

  if (!body.question_text?.trim()) {
    return NextResponse.json({ error: 'question_text required' }, { status: 400 })
  }

  const questionHash = createHash('sha256').update(body.question_text).digest('hex')

  const { data, error } = await supabaseAdmin
    .from('industry_ai_visibility_questions')
    .insert({
      industry_code: body.industry_code,
      intent_layer:  body.intent_layer,
      geo_scope:     body.geo_scope,
      country:       body.country ?? null,
      city:          body.city ?? null,
      language:      body.language,
      question_text: body.question_text.trim(),
      question_hash: questionHash,
      platforms:     body.platforms ?? ['chatgpt', 'google_ai_overview', 'google_serp'],
      notes:         body.notes ?? null,
    })
    .select()
    .single()

  if (error) {
    // Unique violation = duplicate question_hash
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Question with this exact text already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
