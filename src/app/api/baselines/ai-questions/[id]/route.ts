/**
 * PATCH  /api/baselines/ai-questions/[id]  — update question (admin only)
 * DELETE /api/baselines/ai-questions/[id]  — soft-delete by setting is_active=false (admin only)
 *
 * IMPORTANT: question_text is IMMUTABLE once locked_at is set. Editing the
 * text after collection has started would break time-series continuity.
 * To replace a question, deactivate it and create a new one.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { id } = await ctx.params
  const body = await req.json() as {
    notes?: string | null
    is_active?: boolean
    platforms?: string[]
    intent_layer?: string
    question_text?: string  // only allowed if locked_at is null
  }

  // Load existing to check locked_at
  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('industry_ai_visibility_questions')
    .select('locked_at')
    .eq('id', id)
    .single()

  if (loadErr || !existing) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}
  if (body.notes        !== undefined) updates.notes        = body.notes
  if (body.is_active    !== undefined) updates.is_active    = body.is_active
  if (body.platforms    !== undefined) updates.platforms    = body.platforms
  if (body.intent_layer !== undefined) updates.intent_layer = body.intent_layer

  if (body.question_text !== undefined) {
    if (existing.locked_at) {
      return NextResponse.json({
        error: 'Cannot edit question_text after collection has started (locked_at is set). Deactivate this question and create a new one instead.',
      }, { status: 409 })
    }
    updates.question_text = body.question_text
  }

  const { data, error } = await supabaseAdmin
    .from('industry_ai_visibility_questions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { id } = await ctx.params

  // Soft delete: set is_active=false to preserve snapshots history
  const { error } = await supabaseAdmin
    .from('industry_ai_visibility_questions')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
