'use client'

/**
 * GbpPanel — Google Business Profile connection manager.
 *
 * Thin GBP-specific configuration of PlatformConnectionPanel (see that file
 * for the shared loading/error/disconnected/needs_reconnect/connected states).
 * Behaviour is unchanged from the pre-extraction version — this is a pure
 * refactor (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md PR1).
 *
 * Phase 24.A.7
 */

import { PlatformConnectionPanel } from './PlatformConnectionPanel'

interface Props {
  clientId: string
}

export function GbpPanel({ clientId }: Props) {
  return (
    <PlatformConnectionPanel
      clientId={clientId}
      apiPath="gbp"
      icon="📍"
      title="Google Business Profile"
      description="连接 GBP 后，Magic Engine 可以获取业务表现数据、地址信息和评价。"
      connectHref={`/api/auth/google/gbp/start?clientId=${clientId}`}
      connectLabel="连接 Google Business Profile"
      disconnectConfirmMessage="确认断开 Google Business Profile 连接？"
      errorFallbackMessage="GBP 连接授权已失效，需要重新授权。"
      showLocation
    />
  )
}
