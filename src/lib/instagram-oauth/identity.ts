/** Client-safe Instagram identity rules, shared by consent and saved-fact projection. */
export const INSTAGRAM_SCOPES = ['instagram_business_basic'] as const
/** Read-only scope plus Reels publishing. Only requested/required while the publish switch is on. */
export const INSTAGRAM_PUBLISH_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'] as const

/** Server-side switch (default off). Exactly "true" turns it on. Reads a non-public env var, so calling it from a
 * client component silently yields false: call it only in server code (routes, lib). */
export function isInstagramPublishEnabled(): boolean {
  return process.env.INSTAGRAM_PUBLISH_ENABLED === 'true'
}

/** The permission set a saved grant must contain to count as usable right now. */
export function requiredInstagramScopes(): readonly string[] {
  return isInstagramPublishEnabled() ? INSTAGRAM_PUBLISH_SCOPES : INSTAGRAM_SCOPES
}

export function normalizeInstagramHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const handle = value.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_.]{1,30}$/.test(handle) && !handle.startsWith('.')
    && !handle.endsWith('.') && !handle.includes('..') ? handle : null
}

export function isInstagramAccountId(value: unknown): value is string {
  // Never coerce JSON numbers: Instagram IDs can exceed JS's safe integer range.
  return typeof value === 'string' && /^\d{5,40}$/.test(value)
}

export const INSTAGRAM_OUTCOMES = {
  connected: 'Instagram 授权已保存。当前仅连接账号资料，尚不支持发布。',
  denied: '你已取消本次授权，现有连接未改变。',
  bad_state: '此次连接已失效，请从客户设置重新开始。',
  unavailable: 'Instagram 原生授权暂未开放，请联系团队核实配置。',
  target_missing: '请先登记有效的 Instagram 用户名，再开始连接。',
  target_changed: '登记账号在连接期间发生变化，本次未保存。请核对后重新开始。',
  account_mismatch: '本次登录账号与登记账号不一致，因此未保存。请切换至登记账号重试；登记有误请先更正资料。',
  save_failed: '平台已返回授权，但 ME 未能核实保存记录。请刷新授权状态；若仍未连接，再重新授权。',
  verify_failed: '暂时未能完成连接，已保存的资料未改变。请重试或让团队核实。',
} as const
export type InstagramOutcome = keyof typeof INSTAGRAM_OUTCOMES

export function instagramOutcomeMessage(value: string | null): string | null {
  return value && Object.prototype.hasOwnProperty.call(INSTAGRAM_OUTCOMES, value)
    ? INSTAGRAM_OUTCOMES[value as InstagramOutcome] : null
}
