'use client'
import { useEffect, useState } from 'react'

export function ClientVideoPreview({ clientId, assetId }: { clientId: string; assetId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setUrl(null); setError(false)
    fetch(`/api/clients/${clientId}/assets/video?asset_id=${assetId}`)
      .then(async res => { if (!res.ok) throw new Error(); return res.json() })
      .then(data => { if (!cancelled) setUrl(data.asset.storage_url) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [clientId, assetId])
  return url ? <video controls preload="metadata" src={url} className="max-h-64 w-full rounded" />
    : <p className="text-xs text-gray-500">{error ? '视频已失效或不可访问' : '读取视频…'}</p>
}
