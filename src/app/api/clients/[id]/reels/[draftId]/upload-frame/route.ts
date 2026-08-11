import { requireDashboardClientAccess } from '@/lib/auth/client-access'
/**
 * POST /api/clients/[id]/reels/[draftId]/upload-frame
 *
 * Upload a reference frame image (opening or closing) for a Reels draft.
 * Stores in Supabase Storage `visual-assets` bucket.
 * Updates the draft's opening_frame_url or closing_frame_url.
 *
 * Accepts multipart/form-data: file, frame_type ('opening' | 'closing')
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
const VISUAL_BUCKET = 'visual-assets'

type RouteContext = { params: { id: string; draftId: string } }

async function ensureBucket(bucket: string) {
  const { error: createErr } = await supabaseAdmin.storage.createBucket(bucket, { public: true })
  if (createErr && !createErr.message.toLowerCase().includes('already exists')) {
    throw createErr
  }
  await supabaseAdmin.storage.updateBucket(bucket, { public: true, fileSizeLimit: null })
}

export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, draftId } = params

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const frameType = formData.get('frame_type') as string | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }

    if (!frameType || !['opening', 'closing'].includes(frameType)) {
      return NextResponse.json(
        { success: false, error: 'frame_type must be "opening" or "closing"' },
        { status: 400 }
      )
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `Unsupported type: ${file.type}. Use JPEG, PNG, or WebP.` },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: `File too large (${Math.round(file.size / 1024 / 1024)} MB). Max 50 MB.` },
        { status: 400 }
      )
    }

    // Verify draft exists for this client
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('reels_drafts')
      .select('id')
      .eq('id', draftId)
      .eq('client_id', clientId)
      .single()

    if (draftErr || !draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    await ensureBucket(VISUAL_BUCKET)

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const storagePath = `${clientId}/reels/${draftId}/${frameType}_frame_${Date.now()}.${ext}`

    const bytes = await file.arrayBuffer()
    const { error: storageErr } = await supabaseAdmin.storage
      .from(VISUAL_BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: true })

    if (storageErr) throw storageErr

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(VISUAL_BUCKET)
      .getPublicUrl(storagePath)

    // Update the draft with the new frame URL
    const urlField = frameType === 'opening' ? 'opening_frame_url' : 'closing_frame_url'

    // Check if both frames are now set (to update status)
    const { data: updatedDraft, error: updateErr } = await supabaseAdmin
      .from('reels_drafts')
      .update({ [urlField]: publicUrl })
      .eq('id', draftId)
      .select('opening_frame_url, closing_frame_url')
      .single()

    if (updateErr) throw updateErr

    // Auto-advance status to images_ready when both frames are set
    if (updatedDraft?.opening_frame_url && updatedDraft?.closing_frame_url) {
      await supabaseAdmin
        .from('reels_drafts')
        .update({ status: 'images_ready' })
        .eq('id', draftId)
    }

    return NextResponse.json({
      success: true,
      frame_type: frameType,
      url: publicUrl,
    })

  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[reels/upload-frame] error:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
