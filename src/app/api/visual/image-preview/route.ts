import { NextRequest, NextResponse } from 'next/server'
import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64 } from '@/lib/visual/storage'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// POST /api/visual/image-preview
// Generates an image from a raw prompt and returns the storage URL.
// No DB record created — used for inline preview in Social Plan Studio.
// Body: { prompt: string, client_id: string, aspect_ratio?: string }
export async function POST(req: NextRequest) {
  try {
    const { prompt, client_id, aspect_ratio = '1:1' } = await req.json() as {
      prompt?: string
      client_id?: string
      aspect_ratio?: string
    }

    if (!prompt || !client_id) {
      return NextResponse.json(
        { success: false, error: 'prompt and client_id required' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(client_id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const { b64 } = await generateImage({ prompt, aspect_ratio })

    const { storage_url } = await uploadFromBase64({
      base64:    b64,
      clientId:  client_id,
      folder:    'social-preview',
      assetType: 'image',
      variant:   1,
    })

    return NextResponse.json({ success: true, image_url: storage_url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[image-preview]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
