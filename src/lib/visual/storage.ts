import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'visual-assets'

/** Create the bucket if it doesn't exist; always clear any size limit. */
async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: true })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw error
  }
  await supabaseAdmin.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: null })
}

export async function uploadFromBase64(params: {
  base64: string
  clientId: string
  postId?: string
  assetType: 'image' | 'video' | 'avatar_video'
  variant?: 1 | 2
  folder?: string
}): Promise<{ storage_url: string; file_size_kb: number }> {
  const { base64, clientId, postId, assetType, variant = 1, folder } = params

  const bytes = Buffer.from(base64, 'base64')
  const fileSizeKb = Math.round(bytes.length / 1024)

  const timestamp = Date.now()
  const subPath = folder ?? postId ?? 'misc'
  const path = `${clientId}/${subPath}/${assetType}-v${variant}-${timestamp}.png`

  await ensureBucket()

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: true })

  if (error) throw error

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)

  return { storage_url: urlData.publicUrl, file_size_kb: fileSizeKb }
}

export async function uploadFromUrl(params: {
  sourceUrl: string
  clientId: string
  postId?: string        // optional — Reels drafts have no post_id
  assetType: 'image' | 'video' | 'avatar_video'
  variant?: 1 | 2       // optional — defaults to 1
  folder?: string        // optional override for the storage sub-path
}): Promise<{ storage_url: string; file_size_kb: number }> {
  const { sourceUrl, clientId, postId, assetType, variant = 1, folder } = params

  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`Failed to fetch asset from ${sourceUrl}`)

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const fileSizeKb = Math.round(bytes.length / 1024)

  const ext = assetType === 'image' ? 'jpg' : 'mp4'
  const timestamp = Date.now()
  const subPath = folder ?? postId ?? 'misc'
  const path = `${clientId}/${subPath}/${assetType}-v${variant}-${timestamp}.${ext}`

  await ensureBucket()

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: assetType === 'image' ? 'image/jpeg' : 'video/mp4',
      upsert: true,
    })

  if (error) throw error

  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET)
    .getPublicUrl(path)

  return {
    storage_url: urlData.publicUrl,
    file_size_kb: fileSizeKb,
  }
}
