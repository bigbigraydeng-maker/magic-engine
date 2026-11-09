/**
 * Inngest 接收端点的生产 fail-closed 守卫判据（#1346，三审共识，抽出供直测）。
 *
 * 🔴 端点安全全压在 Inngest 的 `mode === cloud`：非 cloud 模式下签名校验被整段跳过
 *    （node_modules/inngest/components/InngestCommHandler.js:1443）。mode 由 NODE_ENV +
 *    INNGEST_DEV 推定。生产里若 signing key 缺失、或 INNGEST_DEV 被设成真值（静默关校验），
 *    都必须拒绝服务，而不是裸奔。
 */

/** INNGEST_DEV 是否被设成会关掉签名校验的真值。'false' / '0' / 空 视为未开启。 */
export function inngestDevDisabled(raw: string | undefined): boolean {
  if (!raw) return false
  const v = raw.trim().toLowerCase()
  return v !== '' && v !== 'false' && v !== '0'
}

/** 生产 fail-closed 判据。返回拒绝原因；null = 放行。非生产环境一律放行（本地/预览走 dev 模式）。 */
export function productionGuardError(env: {
  nodeEnv: string | undefined
  signingKey: string | undefined
  inngestDev: string | undefined
}): string | null {
  if (env.nodeEnv !== 'production') return null
  if (!env.signingKey || env.signingKey.trim().length === 0) {
    return 'INNGEST_SIGNING_KEY missing in production — refusing to serve unverified requests'
  }
  if (inngestDevDisabled(env.inngestDev)) {
    return 'INNGEST_DEV is set in production — it disables signature verification; refusing to serve'
  }
  return null
}
