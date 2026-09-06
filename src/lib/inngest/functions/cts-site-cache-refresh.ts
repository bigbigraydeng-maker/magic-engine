/**
 * CTS Site cache refresh & verify (Issue: brochure/blog rollout, 2026-09-07).
 *
 * Trigger: cts_site.data.updated  (fired by /api/webhooks/chinatravel-push
 *   after HMAC-verifying a chinatravel push to main.)
 *
 * What it does:
 *   1. Wait ~3 min for Render to finish the Next.js production build.
 *   2. POST /api/revalidate on chinatravel for every path that the plan
 *      says might have gone stale (Next.js Full Route Cache).
 *   3. Purge the same paths in Cloudflare's edge cache.
 *   4. Fetch each path once with a cache-buster; smoke-check the
 *      response (200, non-empty body, header shapes).
 *   5. Emit outcome event (cts_site.deploy.verified or .failed) so
 *      downstream consumers (Slack alert, dashboard, etc.) can pick up.
 *
 * Fail-closed:
 *   - Missing REVALIDATE / CF credentials do not silently succeed;
 *     the helper returns { ok:false, errors:[...] } and this function
 *     reports it in the outcome.
 *   - A push with no site-affecting file changes short-circuits with
 *     `skipped: 'no_site_change'` before spending any request budget.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { planSiteRefresh, pathsFromPlan } from '@/lib/site-refresh/paths'
import { revalidateCtsPaths } from '@/lib/site-refresh/next-revalidate'
import { purgeCloudflarePaths } from '@/lib/site-refresh/cf-purge'
import { verifyCtsPaths } from '@/lib/site-refresh/verify'

export const CTS_SITE_DATA_UPDATED_EVENT = 'cts_site.data.updated'
export const CTS_SITE_DEPLOY_VERIFIED_EVENT = 'cts_site.deploy.verified'
export const CTS_SITE_DEPLOY_FAILED_EVENT = 'cts_site.deploy.failed'

export interface CtsSiteDataUpdatedPayload {
  commit_sha: string
  ref: string
  changed_files: string[]
  triggered_at_ms: number
}

export const ctsSiteCacheRefresh = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}cts-site-cache-refresh`,
    name: 'CTS Site: refresh Next.js + Cloudflare cache, verify',
    retries: 2,
  },
  { event: CTS_SITE_DATA_UPDATED_EVENT },
  async ({ event, step }) => {
    const data = event.data as Partial<CtsSiteDataUpdatedPayload>
    const changedFiles = Array.isArray(data.changed_files) ? data.changed_files : []
    const commitSha = typeof data.commit_sha === 'string' ? data.commit_sha : ''

    const plan = planSiteRefresh(changedFiles)
    if (!plan.hasSiteChange) {
      return {
        ok: true,
        skipped: 'no_site_change',
        commit_sha: commitSha,
        reasons: plan.reasons,
      }
    }

    const paths = pathsFromPlan(plan)

    // Give Render enough time to complete the build for this commit.
    await step.sleep('wait-for-render-build', '3m')

    const revalidate = await step.run('revalidate-nextjs', async () =>
      revalidateCtsPaths(paths),
    )

    const purge = await step.run('purge-cloudflare', async () =>
      purgeCloudflarePaths(paths),
    )

    // Light settle window between purge and verify (edge propagation).
    await step.sleep('post-purge-settle', '20s')

    const verify = await step.run('verify-paths', async () => verifyCtsPaths(paths))

    const ok = revalidate.ok && purge.ok && verify.ok
    await step.sendEvent('emit-outcome', {
      name: ok ? CTS_SITE_DEPLOY_VERIFIED_EVENT : CTS_SITE_DEPLOY_FAILED_EVENT,
      data: {
        commit_sha: commitSha,
        paths,
        revalidate,
        purge,
        verify,
        plan_reasons: plan.reasons,
        triggered_at_ms: data.triggered_at_ms ?? null,
      },
    })

    return {
      ok,
      commit_sha: commitSha,
      paths,
      revalidate_ok: revalidate.ok,
      purge_ok: purge.ok,
      verify_ok: verify.ok,
    }
  },
)
