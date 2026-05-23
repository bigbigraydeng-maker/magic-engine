/**
 * POST /api/admin/viral-references/upload
 *
 * Accepts multipart/form-data with a video file. Saves it to /tmp,
 * inserts a row as 'pending' with platform='upload', then runs analysis
 * in the background using Gemini Files API directly (no yt-dlp needed).
 *
 * Form fields:
 *   - file:         video file (mp4/mov/webm/etc, max ~100MB)
 *   - industry:     'travel' | 'flooring' (required)
 *   - content_goal: 'brand' | 'sales' | 'ugc' | 'education' (optional, default 'brand')
 *   - notes:        optional text
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyzeUploadedReference } from '@/lib/reels/viral-analyzer'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

// Allow up to ~100MB file uploads on this route
export const maxDuration = 300 // 5 minutes for slow uploads + Gemini analysis

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/mpeg',
])

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const industry = String(formData.get('industry') ?? '').trim()
  const contentGoal = String(formData.get('content_goal') ?? 'brand').trim()
  const notes = (formData.get('notes') as string | null)?.trim() || null

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
  }
  if (!industry) {
    return NextResponse.json({ success: false, error: 'industry is required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { success: false, error: `Unsupported file type: ${file.type}. Use MP4/MOV/WebM.` },
      { status: 400 }
    )
  }

  // 1. Insert pending row
  const sourceLabel = `upload://${file.name}`
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('viral_reference_library')
    .insert({
      source_url: sourceLabel,
      industry,
      content_goal: contentGoal,
      platform: 'upload',
      notes,
      video_title: file.name,
      analysis_status: 'pending',
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return NextResponse.json(
      { success: false, error: insertErr?.message ?? 'Insert failed' },
      { status: 500 }
    )
  }

  // 2. Save file to /tmp
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
  const tmpPath = path.join(tmpdir(), `viral_upload_${inserted.id}.${ext}`)

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(tmpPath, buffer)
  } catch (err) {
    await supabaseAdmin
      .from('viral_reference_library')
      .update({
        analysis_status: 'error',
        analysis_error: err instanceof Error ? err.message : 'Failed to save uploaded file',
      })
      .eq('id', inserted.id)
    return NextResponse.json(
      { success: false, error: 'Failed to save uploaded file' },
      { status: 500 }
    )
  }

  // 3. Kick off analysis (await briefly so we return after status changes to analyzing)
  analyzeUploadedReference(inserted.id, tmpPath, file.type)
    .finally(() => {
      unlink(tmpPath).catch(() => {})
    })

  return NextResponse.json({
    success: true,
    id: inserted.id,
    message: 'Upload received — analysis running in background',
  })
}
