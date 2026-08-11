'use client'

/**
 * GscPanel — Google Search Console connection status.
 *
 * "Connect" points at the shared merged-scope flow (GSC + GA4 + Indexing in
 * one consent, see /api/auth/google/connect) — not a GSC-only OAuth route.
 * One click here connects both this panel and Ga4Panel below it.
 */

import { PlatformConnectionPanel } from './PlatformConnectionPanel'

interface Props {
  clientId: string
}

export function GscPanel({ clientId }: Props) {
  return (
    <PlatformConnectionPanel
      clientId={clientId}
      apiPath="gsc"
      icon="🔎"
      title="Google Search Console"
      description="连接后拉取真实的搜索 query、展示量、点击率、排名数据。"
      connectHref={`/api/auth/google/connect?client_id=${clientId}&flow=admin`}
      connectLabel="连接 Google 网站数据"
      disconnectConfirmMessage="确认断开 Google Search Console 连接？"
      errorFallbackMessage="Google Search Console 连接授权已失效，需要重新授权。"
    />
  )
}
