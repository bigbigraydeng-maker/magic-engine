/**
 * 解析某个客户的 Meta 转化 API 凭据（Issue #1397 · L4 客户配置）。
 *
 * 🔴 与既有的 `getMetaTokenForClient` 有一处**刻意的不同：不回落到共享令牌**。
 *
 * 既有那个函数在找不到客户专属令牌时会回落到 `META_SYSTEM_USER_TOKEN`，
 * 对"读广告数据"是合理的（读错了顶多报错）。但回写成交是**往客户的广告
 * 账户里写东西**：拿 A 客户的令牌配 B 客户的 pixel，轻则失败，重则把 B 的
 * 成交写进 A 的广告优化里 —— 而 Meta 没有删除端点，写错了撤不回。
 *
 * 所以这里是 fail-closed：配齐了才发，缺一样就报错停下。
 */

import { createClient } from '@supabase/supabase-js'
import { domainToEnvKey, loadStoredClientMetaToken } from '@/lib/meta/token-manager'

export type CapiCredentials = {
  clientId: string
  pixelId: string
  accessToken: string
  /** 这两个值分别来自哪个环境变量 —— 出问题时待办要能告诉人去哪里配。 */
  source: { tokenEnv: string; pixelEnv: string }
}

function supabase() {
  // SDK 客户端在函数内部初始化，不在模块顶层（构建期没有环境变量）。
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export class CapiConfigError extends Error {
  constructor(
    message: string,
    /** 给待办用：缺的到底是哪一样。 */
    readonly missing: 'client' | 'domain' | 'token' | 'pixel',
    /** 该去配哪个环境变量。 */
    readonly envHint: string | null = null,
  ) {
    super(message)
    this.name = 'CapiConfigError'
  }
}

/**
 * 环境变量命名沿用既有规范（`domainToEnvKey`）：
 *   ctstours.co.nz → META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ
 *                  → META_PIXEL_ID_CTSTOURS_CO_NZ
 */
export function pixelEnvVar(domain: string): string {
  return `META_PIXEL_ID_${domainToEnvKey(domain)}`
}

export function tokenEnvVar(domain: string): string {
  return `META_SYSTEM_USER_TOKEN_${domainToEnvKey(domain)}`
}

export async function resolveCapiConfig(clientId: string): Promise<CapiCredentials> {
  const { data, error } = await supabase()
    .from('clients')
    .select('id, domain')
    .eq('id', clientId)
    .maybeSingle()

  if (error) {
    throw new CapiConfigError(`读取客户配置失败：${error.message}`, 'client')
  }
  if (!data) {
    throw new CapiConfigError('客户不存在', 'client')
  }

  const domain = (data as { domain: string | null }).domain
  if (!domain) {
    // 没有域名就推导不出环境变量名。与其猜，不如停。
    throw new CapiConfigError(
      '该客户没有配置域名，无法推导出对应的环境变量名',
      'domain',
    )
  }

  const tokenEnv = tokenEnvVar(domain)
  const pixelEnv = pixelEnvVar(domain)

  // Preferred: DB-stored per-client token (post-migration path).
  const dbToken = await loadStoredClientMetaToken(supabase(), clientId)
  const accessToken = dbToken ?? process.env[tokenEnv]
  if (!accessToken) {
    throw new CapiConfigError(
      `缺少该客户的 Meta 令牌（${tokenEnv}）。刻意不回落到共享令牌 —— 拿别人的令牌写成交撤不回。`,
      'token',
      tokenEnv,
    )
  }

  const pixelId = process.env[pixelEnv]
  if (!pixelId) {
    throw new CapiConfigError(`缺少该客户的 Meta pixel（${pixelEnv}）`, 'pixel', pixelEnv)
  }

  return {
    clientId, pixelId, accessToken,
    source: { tokenEnv: dbToken ? 'platform_oauth_connections' : tokenEnv, pixelEnv },
  }
}
