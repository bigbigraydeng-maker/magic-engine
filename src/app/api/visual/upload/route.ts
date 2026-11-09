import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mov']
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]
const MAX_SIZE_BYTES = 500 * 1024 * 1024 // 500 MB — generous limit for video uploads
const VISUAL_BUCKET = 'visual-assets'

/**
 * Create the bucket if it doesn't exist, then update the size limit.
 * updateBucket is always called so existing buckets with old limits are fixed too.
 */
async function ensureBucket(bucket: string, isPublic = true) {
  // Create if not exists (ignore "already exists" error)
  const { error: createErr } = await supabaseAdmin.storage.createBucket(bucket, {
    public: isPublic,
  })
  if (createErr && !createErr.message.toLowerCase().includes('already exists')) {
    throw createErr
  }
  // Always update to clear any restrictive fileSizeLimit on existing buckets
  await supabaseAdmin.storage.updateBucket(bucket, {
    public: isPublic,
    fileSizeLimit: null, // no bucket-level cap; project plan limit applies
  })
}

// POST /api/visual/upload
// Accepts multipart/form-data: file, post_id, client_id
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const postId = formData.get('post_id') as string | null
    const clientId = formData.get('client_id') as string | null

    if (!file || !postId || !clientId) {
      return NextResponse.json(
        { success: false, error: 'file, post_id, and client_id are required' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(clientId)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('client_id')
      .eq('id', postId)
      .single()
    if (!post || post.client_id !== clientId) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `Unsupported file type: ${file.type}. Use JPEG, PNG, WebP, GIF, MP4, or MOV.` },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 500MB.` },
        { status: 400 }
      )
    }

    const assetType: 'image' | 'video' = ALLOWED_VIDEO_TYPES.includes(file.type) ? 'video' : 'image'
    const ext = file.name.split('.').pop()?.toLowerCase() ?? (assetType === 'video' ? 'mp4' : 'jpg')
    const storagePath = `${clientId}/${postId}/upload_${Date.now()}.${ext}`

    await ensureBucket(VISUAL_BUCKET)

    const bytes = await file.arrayBuffer()
    const { error: storageError } = await supabaseAdmin.storage
      .from(VISUAL_BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: true })

    if (storageError) throw storageError

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(VISUAL_BUCKET)
      .getPublicUrl(storagePath)

    const { data: asset, error: dbError } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id: postId,
        client_id: clientId,
        asset_type: assetType,
        provider: 'upload',
        generation_status: 'ready',
        storage_url: publicUrl,
        file_size_kb: Math.round(file.size / 1024),
        prompt_used: `Manual upload: ${file.name}`,
      })
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json({
      success: true,
      asset_id: asset.id,
      storage_url: publicUrl,
      asset_type: assetType,
    })
  } catch (err: unknown) {
    // Supabase errors are plain objects with .message, not Error instances
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err)
    console.error('[visual/upload] error detail:', JSON.stringify(err))
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
