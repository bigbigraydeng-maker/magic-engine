'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'

export interface PublishPreviewState {
  preview: PublishPreviewResponse | null
  loading: boolean
  error: string | null
  /** Re-fetch; resolves when the newest request has settled. Never throws. */
  refresh: () => Promise<void>
}

const LOAD_ERROR_TEXT = '服务器暂时没有回应，请稍后重试'

/** An answer in an unexpected shape is treated as no answer, never rendered half-way. */
function isPreview(body: Partial<PublishPreviewResponse> | null): body is PublishPreviewResponse {
  return (
    body !== null &&
    typeof body.publishedVersion === 'number' &&
    Array.isArray(body.changes) &&
    Array.isArray(body.changedTourIds) &&
    Array.isArray(body.firstPublishRows) &&
    typeof body.sellable === 'object' &&
    body.sellable !== null
  )
}

export function usePublishPreview(clientId: string): PublishPreviewState {
  const [preview, setPreview] = useState<PublishPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mySeq = seq.current + 1
    seq.current = mySeq
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/publish`)
      if (seq.current !== mySeq) return
      if (res.ok) {
        const body = (await res.json()) as Partial<PublishPreviewResponse> | null
        if (seq.current !== mySeq) return
        if (!isPreview(body)) {
          setPreview(null)
          setError(LOAD_ERROR_TEXT)
          return
        }
        setPreview(body)
        setError(null)
      } else {
        setPreview(null)
        setError(LOAD_ERROR_TEXT)
      }
    } catch {
      if (seq.current !== mySeq) return
      setPreview(null)
      setError(LOAD_ERROR_TEXT)
    } finally {
      if (seq.current === mySeq) setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { preview, loading, error, refresh }
}
