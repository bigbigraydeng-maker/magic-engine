/**
 * Shared transport + validation helpers for the Story adapters.
 *
 * This module replaces the private `postGraphJson` in ./page-stories and the
 * duplicated failure-handling found in `uploadVideoBytes`, `listPageStories`
 * and `getIgContainerStatus`. Error classification mirrors
 * `publishPagePhotoPost` in ./page-posts so callers can reason about retry
 * safety the same way across posts and stories.
 */

import { PagePublishError, classifyPublishFailure } from './page-posts'

export interface GraphErrorBody {
  message?: string
  code?: number
  error_subcode?: number
}

export interface GraphResponseBody {
  id?: string
  post_id?: string
  video_id?: string
  upload_url?: string
  status_code?: string
  data?: unknown[]
  paging?: { next?: string }
  error?: GraphErrorBody
}

/**
 * Replace every occurrence of each non-empty secret — both raw and
 * URI-encoded — with '***'. Uses split/join so no RegExp escaping is needed.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    if (!secret) continue
    out = out.split(secret).join('***')
    const encoded = encodeURIComponent(secret)
    if (encoded && encoded !== secret) {
      out = out.split(encoded).join('***')
    }
  }
  return out
}

/**
 * Assert that a Graph object id is a plain decimal string. Nothing has been
 * sent at this point, so a bad id is a clear refusal ('rejected').
 */
export function assertGraphId(value: string, label: string): void {
  if (!/^\d+$/.test(value)) {
    throw new PagePublishError(`${label}: invalid id`, { certainty: 'rejected' })
  }
}

/**
 * Assert that a URL is https and, when `allowedHostSuffixes` is provided and
 * non-empty, that its hostname equals or is a subdomain of one of the suffixes.
 * The message never echoes the URL to avoid leaking secrets.
 */
export function assertHttpsUrl(value: string, label: string, allowedHostSuffixes?: string[]): void {
  const fail = (): never => {
    throw new PagePublishError(`${label}: invalid url`, { certainty: 'rejected' })
  }
  if (!value) fail()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return fail()
  }
  if (parsed.protocol !== 'https:') fail()
  if (allowedHostSuffixes && allowedHostSuffixes.length > 0) {
    const host = parsed.hostname
    const ok = allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    if (!ok) fail()
  }
}

/**
 * Perform a Graph request and classify the outcome exactly like
 * `publishPagePhotoPost`:
 *  - fetch throws (no response)            => certainty 'unknown'
 *  - 2xx carrying a Graph error body       => certainty 'unknown'
 *  - non-2xx                               => classifyPublishFailure(status, error)
 * The thrown message never contains any of the supplied secrets.
 */
export async function requestGraph(input: {
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: Record<string, unknown>
  label: string
  secrets: string[]
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<GraphResponseBody> {
  const doFetch = input.fetcher ?? fetch
  const headers: Record<string, string> = { ...(input.headers ?? {}) }
  let body: string | undefined
  if (input.method === 'POST' && input.body) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(input.body)
  }

  let res: Response
  try {
    res = await doFetch(input.url, {
      method: input.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
    })
  } catch (error: unknown) {
    // No response at all: the request may or may not have reached Facebook.
    const reason = error instanceof Error ? error.message : String(error)
    throw new PagePublishError(redactSecrets(reason, input.secrets), { certainty: 'unknown' })
  }

  const parsed = (await res.json().catch(() => null)) as GraphResponseBody | null
  if (!res.ok || parsed?.error) {
    const detail = parsed?.error?.message ?? `HTTP ${res.status}`
    throw new PagePublishError(`${input.label}: ${redactSecrets(detail, input.secrets)}`, {
      // A 2xx that carries an error body is not a clear refusal — treat as unknown.
      certainty: res.ok ? 'unknown' : classifyPublishFailure(res.status, parsed?.error),
      httpStatus: res.status,
      graphCode: parsed?.error?.code ?? null,
      graphSubcode: parsed?.error?.error_subcode ?? null,
    })
  }
  return parsed ?? {}
}

/** POST a JSON body to a Graph edge via `requestGraph`. */
export function postGraphJson(input: {
  url: string
  body: Record<string, unknown>
  label: string
  secrets: string[]
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<GraphResponseBody> {
  return requestGraph({ ...input, method: 'POST' })
}

/** GET a Graph edge via `requestGraph`. */
export function getGraphJson(input: {
  url: string
  label: string
  secrets: string[]
  timeoutMs?: number
  fetcher?: typeof fetch
}): Promise<GraphResponseBody> {
  return requestGraph({ ...input, method: 'GET' })
}
