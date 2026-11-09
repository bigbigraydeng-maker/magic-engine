import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { safeFetchText } from '@/lib/net/safe-fetch'
import {
  POST_PUBLISH_WATCH_STARTED_EVENT, POST_PUBLISH_CHECK_DUE_EVENT,
  PostPublishWatchStartedSchema, PostPublishCheckDueSchema,
  buildCheckEvents, classifyReceipt, emptyMetrics, parsePageProbe,
  type PageProbe, type PostPublishCheckDue,
} from '@/lib/seo/post-publish-monitor'
import { assertClientOwnsOrigin, persistReceipt, readPageMetrics } from '@/lib/seo/post-publish-monitor-store'

export function createPostPublishFanOutFunction() {
  return inngest.createFunction({
    id: `${CLOUD_FN_PREFIX}seo-post-publish-fanout`,
    name: 'SEO post-publish: fan out T+72h and T+7d checks', retries: 2,
    concurrency: { limit: 1, key: 'event.data.client_id' },
  }, { event: POST_PUBLISH_WATCH_STARTED_EVENT }, async ({ event, step }) => {
    const parsed = PostPublishWatchStartedSchema.safeParse(event.data)
    if (!parsed.success) return { ok: false, reason: 'invalid_payload', issues: parsed.error.issues.slice(0, 8), no_publish: true }
    await step.run('verify-client-origin', () => assertClientOwnsOrigin(supabaseAdmin, parsed.data.client_id, parsed.data.origin_url))
    const checks = buildCheckEvents(parsed.data)
    await step.sendEvent('dispatch-independent-checkpoints', checks)
    return { ok: true, pages: parsed.data.pages.length, checks_dispatched: checks.length, no_publish: true }
  })
}

export function createPostPublishCheckFunction(deps = { fetchText: safeFetchText }) {
  return inngest.createFunction({
    id: `${CLOUD_FN_PREFIX}seo-post-publish-check`, name: 'SEO post-publish: check one page/window', retries: 3,
    concurrency: { limit: 3, key: 'event.data.client_id' },
    onFailure: async ({ event }) => {
      const nested = (event.data as { event?: { data?: unknown } } | undefined)?.event?.data
      const parsed = PostPublishCheckDueSchema.safeParse(nested)
      if (!parsed.success) return
      const due = parsed.data
      await persistReceipt(supabaseAdmin, due, classifyReceipt({
        due, observedAt: new Date().toISOString(), metrics: emptyMetrics(),
        probe: { status_code: null, final_url: null, canonical_url: null, robots: null, indexable: null, canonical_matches: null, final_url_matches: null, error: 'retries_exhausted' },
      }))
    },
  }, { event: POST_PUBLISH_CHECK_DUE_EVENT }, async ({ event, step }) => {
    const parsed = PostPublishCheckDueSchema.safeParse(event.data)
    if (!parsed.success) return { ok: false, reason: 'invalid_payload', issues: parsed.error.issues.slice(0, 8), no_publish: true }
    const due = parsed.data
    await step.run('verify-client-origin', () => assertClientOwnsOrigin(supabaseAdmin, due.client_id, due.origin_url))
    await step.sleepUntil(`wait-${due.checkpoint_hours}h`, new Date(due.target_at))
    const probe = await step.run('probe-page', async (): Promise<PageProbe> => {
      try {
        const response = await deps.fetchText(due.page.url, { timeoutMs: 15_000, maxRedirects: 3, maxResponseBytes: 2 * 1024 * 1024 })
        return parsePageProbe({ requestedUrl: due.page.url, status: response.status, finalUrl: response.url, html: response.text, xRobotsTag: response.headers.get('x-robots-tag') })
      } catch (error) {
        return { status_code: null, final_url: null, canonical_url: null, robots: null, indexable: null, canonical_matches: null, final_url_matches: null, error: error instanceof Error ? error.message : 'page_probe_failed' }
      }
    })
    const metrics = await step.run('read-page-metrics', () => readPageMetrics(supabaseAdmin, due.client_id, due.page.url))
    const receipt = classifyReceipt({ due, observedAt: new Date().toISOString(), probe, metrics })
    await step.run('persist-idempotent-receipt', () => persistReceipt(supabaseAdmin, due, receipt))
    return receipt
  })
}

export const postPublishFanOut = createPostPublishFanOutFunction()
export const postPublishCheck = createPostPublishCheckFunction()
