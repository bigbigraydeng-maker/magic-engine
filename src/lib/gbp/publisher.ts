/**
 * GBP (Google Business Profile) post publisher — P8.12.S3.4
 *
 * publishToGbp(input) attempts to publish a local post via the GBP Management API.
 * If credentials or location_name are absent, or if the API call fails, it
 * degrades gracefully to draft mode — never throws.
 *
 * Degradation conditions:
 *   1. GOOGLE_GBP_ACCESS_TOKEN env var not set → draft
 *   2. location_name not provided → draft
 *   3. API returns non-2xx → draft (+ reason recorded)
 *   4. Network/fetch error → draft (+ reason recorded)
 *
 * GBP API reference:
 *   POST https://mybusiness.googleapis.com/v4/{parent}/localPosts
 *   Auth: Bearer token (OAuth 2.0, scope: business.manage)
 */

export interface GbpPostInput {
  /** Required: the main post body text (max ~1500 chars for GBP). */
  post_text: string
  /** Post topic type — defaults to STANDARD. */
  post_type?: 'STANDARD' | 'OFFER'
  /** Optional call-to-action button type. */
  cta_type?: 'CALL' | 'BOOK' | 'SHOP' | 'SIGN_UP' | 'ORDER' | 'LEARN_MORE'
  /** CTA destination URL (required when cta_type is provided). */
  cta_url?: string
  /**
   * GBP location resource name: accounts/{accountId}/locations/{locationId}.
   * Without this the publisher always falls back to draft mode.
   * Resolve it with lib/gbp/location.ts > resolveGbpLocation.
   */
  location_name?: string
  /**
   * Per-client OAuth access token (lib/gbp/auth.ts > getGbpAccessToken).
   * Preferred over the legacy GOOGLE_GBP_ACCESS_TOKEN env var, which was
   * never configured in production — that is why ME had published zero
   * GBP posts before this path existed.
   */
  access_token?: string
}

export type GbpPublishMode = 'live' | 'draft'

export interface GbpPublishResult {
  mode: GbpPublishMode
  /** live only: GBP resource name of the created post. */
  post_name?: string
  /** draft only: formatted text ready to copy-paste into GBP UI. */
  draft_text?: string
  /** Draft only: reason why live publish was not attempted or failed. */
  degradation_reason?: string
}

const GBP_API_BASE = 'https://mybusiness.googleapis.com/v4'

/**
 * Static env token — legacy path, never configured in production.
 * Callers that know their client should pass `access_token` instead
 * (see lib/gbp/auth.ts > getGbpAccessToken).
 */
function getEnvAccessToken(): string | null {
  return process.env.GOOGLE_GBP_ACCESS_TOKEN ?? null
}

function buildDraftText(input: GbpPostInput): string {
  const lines: string[] = [
    '【GBP 发帖草稿 — 请人工复制到 Google Business Profile 后台发布】',
    '',
    '正文：',
    input.post_text,
  ]
  if (input.cta_type) {
    lines.push('')
    lines.push(`CTA 按钮类型：${input.cta_type}`)
    if (input.cta_url) lines.push(`CTA 链接：${input.cta_url}`)
  }
  if (input.post_type && input.post_type !== 'STANDARD') {
    lines.push('')
    lines.push(`发帖类型：${input.post_type}`)
  }
  lines.push('')
  lines.push('发布步骤：登录 business.google.com → 选择地点 → 发帖 → 新建帖子 → 粘贴上方正文并配置 CTA。')
  return lines.join('\n')
}

function draftResult(input: GbpPostInput, reason: string): GbpPublishResult {
  return {
    mode: 'draft',
    draft_text: buildDraftText(input),
    degradation_reason: reason,
  }
}

/**
 * Publish a GBP local post, or degrade to draft if credentials / permissions
 * are unavailable.
 */
export async function publishToGbp(input: GbpPostInput): Promise<GbpPublishResult> {
  // Per-client OAuth token (preferred) → legacy env var → draft.
  const token = input.access_token ?? getEnvAccessToken()
  if (!token) {
    return draftResult(input, '这个客户的 Google 商家页还没连上 —— 先存成草稿，没有发出去。')
  }

  const { location_name } = input
  if (!location_name) {
    return draftResult(input, '还没确认要发到哪一家门店 —— 先存成草稿，没有发出去。')
  }
  // Shape guard: this string goes straight into the API path, so anything
  // that is not exactly accounts/{a}/locations/{l} must not reach Google
  // (魏征 🔴3 — an LLM-supplied value used to flow in here unchecked).
  if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(location_name)) {
    return draftResult(input, '门店编号格式不对，没敢发 —— 先存成草稿，没有发出去。')
  }

  const url = `${GBP_API_BASE}/${location_name}/localPosts`

  const body: Record<string, unknown> = {
    summary: input.post_text,
    topicType: input.post_type ?? 'STANDARD',
  }
  if (input.cta_type) {
    body.callToAction = {
      actionType: input.cta_type,
      ...(input.cta_url ? { url: input.cta_url } : {}),
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      return draftResult(input, `Google 那边拒绝了这次发布（错误码 ${res.status}）—— 先存成草稿，没有发出去。`)
    }

    const data = (await res.json()) as { name?: string }
    return {
      mode: 'live',
      post_name: data.name,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return draftResult(input, `没连上 Google（网络或对方服务的问题：${msg}）—— 先存成草稿，没有发出去。`)
  }
}
