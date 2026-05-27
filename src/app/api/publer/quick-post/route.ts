/**
 * POST /api/publer/quick-post
 *
 * Lightweight endpoint used by ContentStudioDrawer → task-level "Send to Launch Hub".
 * Auto-matches Publer account by platform; no visual_assets / content_posts records needed.
 *
 * Body: { caption, hashtags?, image_url?, platform, scheduled_at }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAccounts, uploadMediaFromUrl, schedulePost } from '@/lib/publer/client'

interface QuickPostBody {
  caption: string
  hashtags?: string[]
  image_url?: string
  /** 'facebook' | 'instagram' | 'tiktok' */
  platform: string
  scheduled_at: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as QuickPostBody
    const { caption, hashtags, image_url, platform, scheduled_at } = body

    if (!caption?.trim() || !platform || !scheduled_at) {
      return NextResponse.json(
        { success: false, error: 'caption, platform, scheduled_at are required' },
        { status: 400 },
      )
    }

    // Find first Publer account matching the platform
    const accounts = await getAccounts()
    const account = accounts.find(a => a.provider?.toLowerCase() === platform.toLowerCase())
    if (!account) {
      return NextResponse.json(
        { success: false, error: `No Publer account connected for platform: ${platform}` },
        { status: 404 },
      )
    }

    const fullCaption = hashtags?.length
      ? `${caption}\n\n${hashtags.join(' ')}`
      : caption

    // Upload image to Publer if provided
    let media: { id: string; type: string } | null = null
    if (image_url) {
      const fileName = image_url.split('/').pop()?.split('?')[0] ?? 'image.jpg'
      media = await uploadMediaFromUrl(image_url, fileName)
    }

    const result = await schedulePost({
      accountId: account.id,
      provider:  account.provider,
      assetType: media ? 'image' : 'text',
      media,
      caption:    fullCaption,
      scheduledAt: new Date(scheduled_at).toISOString(),
    })

    return NextResponse.json({ success: true, job_id: result.job_id ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/quick-post]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
