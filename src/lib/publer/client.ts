// Publer REST API v1 client
// Auth: Bearer-API key + Publer-Workspace-Id header (not standard Bearer)

const PUBLER_BASE = 'https://app.publer.com/api/v1'

function publerHeaders() {
  return {
    'Authorization': `Bearer-API ${process.env.PUBLER_API_KEY}`,
    'Publer-Workspace-Id': process.env.PUBLER_WORKSPACE_ID!,
    'Content-Type': 'application/json',
  }
}

export interface PublerAccount {
  id: string
  provider: string
  name: string
  picture?: string
  type?: string
}

export async function getAccounts(): Promise<PublerAccount[]> {
  const res = await fetch(`${PUBLER_BASE}/accounts`, { headers: publerHeaders() })
  if (!res.ok) throw new Error(`Publer getAccounts error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.accounts ?? data ?? []
}

// 下载文件并以 multipart 上传给 Publer，直接拿到 media ID
export async function uploadMediaFromUrl(url: string, name: string): Promise<{ id: string; type: string }> {
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Failed to fetch media from storage: ${imgRes.status}`)
  const blob = await imgRes.blob()
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg'

  const form = new FormData()
  form.append('file', blob, name)

  // FormData 上传时不加 Content-Type（让浏览器/Node 自动设 boundary）
  const { Authorization, 'Publer-Workspace-Id': workspaceId } = publerHeaders()
  const res = await fetch(`${PUBLER_BASE}/media`, {
    method: 'POST',
    headers: { Authorization, 'Publer-Workspace-Id': workspaceId },
    body: form,
  })
  if (!res.ok) throw new Error(`Publer media upload error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.id) throw new Error(`Publer upload returned no ID: ${JSON.stringify(data)}`)

  const isVideo = contentType.startsWith('video/')
  return { id: data.id, type: isVideo ? 'video' : 'photo' }
}

export async function schedulePost(params: {
  accountId: string
  provider: string
  assetType: string
  /** null = text-only post (no media) */
  media: { id: string; type: string } | null
  caption: string
  scheduledAt: string
}): Promise<{ job_id: string }> {
  const { accountId, provider, assetType, media, caption, scheduledAt } = params
  // Facebook: photo→"photo", video→"video", Instagram: video→"reel", no media→"status"
  const networkType = assetType === 'video'
    ? (provider === 'instagram' ? 'reel' : 'video')
    : media ? 'photo' : 'status'

  const networkPayload: Record<string, unknown> = { type: networkType, text: caption }
  if (media) networkPayload.media = [{ id: media.id, type: media.type }]

  const res = await fetch(`${PUBLER_BASE}/posts/schedule`, {
    method: 'POST',
    headers: publerHeaders(),
    body: JSON.stringify({
      bulk: {
        state: 'scheduled',
        posts: [{
          networks: { [provider]: networkPayload },
          accounts: [{ id: accountId, scheduled_at: scheduledAt }],
        }],
      },
    }),
  })
  if (!res.ok) throw new Error(`Publer schedulePost error ${res.status}: ${await res.text()}`)

  // Return immediately — the 200 response from Publer confirms the post was accepted.
  // The previous 5 s sleep + job-status check was blocking the API response for too long
  // and causing Render request timeouts on the UI side.
  return await res.json()
}
