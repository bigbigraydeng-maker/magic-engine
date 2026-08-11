'use client'

/**
 * Ga4Panel — Google Analytics 4 connection status.
 *
 * Same shared merged-scope "connect" button as GscPanel — one click
 * connects both. Which specific GA4 property is bound is a separate concern
 * handled by Ga4PropertyPanel below (auto-picked on first connect, changeable
 * there if the account has more than one).
 */

import { PlatformConnectionPanel } from './PlatformConnectionPanel'

interface Props {
  clientId: string
}

export function Ga4Panel({ clientId }: Props) {
  return (
    <PlatformConnectionPanel
      clientId={clientId}
      apiPath="ga4"
      icon="📈"
      title="Google Analytics 4"
      description="连接后拉取真实的网站流量数据（会话、用户、页面浏览、跳出率、流量来源）。"
      connectHref={`/api/auth/google/connect?client_id=${clientId}&flow=admin`}
      connectLabel="连接 Google 网站数据"
      disconnectConfirmMessage="确认断开 Google Analytics 4 连接？"
      errorFallbackMessage="Google Analytics 4 连接授权已失效，需要重新授权。"
    />
  )
}
