/**
 * PATCH /api/admin/viral-references/[id]
 * Update the industry label of a single viral reference.
 * Used by the admin UI to correct mis-tagged entries.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const ALLOWED_FIELDS = ['industry'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      const val = body[field]
      if (typeof val !== 'string' || !val.trim()) {
        return NextResponse.json(
          { success: false, error: `${field} must be a non-empty string` },
          { status: 400 }
        )
      }
      updates[field] = val.trim()
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('viral_reference_library')
    .update(updates)
    .eq('id', id)
    .select('id, industry')
    .maybeSingle()

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 })

  return NextResponse.json({ success: true, reference: data })
}
