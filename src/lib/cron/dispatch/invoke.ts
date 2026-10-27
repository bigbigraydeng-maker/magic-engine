import { NextRequest } from 'next/server'
import type { DispatchJob } from './types'

type RouteHandler = (req: NextRequest) => Promise<Response>
interface RouteModule {
  GET?: RouteHandler
  POST?: RouteHandler
}

const LOADERS: Record<string, () => Promise<RouteModule>> = {
  'vision-analyzer': () => import('@/app/api/cron/vision-analyzer/route'),
  'poll-visual-jobs': () => import('@/app/api/cron/poll-visual-jobs/route'),
  'site-audit-jobs': () => import('@/app/api/cron/site-audit-jobs/route'),
  'attribution': () => import('@/app/api/cron/attribution/route'),
  'zhangqian-sweeper': () => import('@/app/api/cron/zhangqian-sweeper/route'),
  'prospecting-sweep': () => import('@/app/api/cron/prospecting-sweep/route'),
  'blog-stuck-generating': () => import('@/app/api/cron/blog-stuck-generating/route'),
  'tailor-made-jobs-sweeper': () => import('@/app/api/cron/tailor-made-jobs-sweeper/route'),
  'ai-tracker-weekly': () => import('@/app/api/cron/ai-tracker-weekly/route'),
  'ai-visibility-weekly': () => import('@/app/api/cron/ai-visibility-weekly/route'),
  'goal-current-value-refresh': () => import('@/app/api/cron/goal-current-value-refresh/route'),
  'keyword-snapshots-weekly': () => import('@/app/api/cron/keyword-snapshots-weekly/route'),
  'seo-weekly-list': () => import('@/app/api/cron/seo-weekly-list/route'),
  'reputation-snapshots-weekly': () => import('@/app/api/cron/reputation-snapshots-weekly/route'),
  'social-engagement-pullback': () => import('@/app/api/cron/social-engagement-pullback/route'),
  'winner-reel-sync-daily': () => import('@/app/api/cron/winner-reel-sync-daily/route'),
  'google-data-pullback-daily': () => import('@/app/api/cron/google-data-pullback-daily/route'),
  'zhuge-recalculate': () => import('@/app/api/cron/zhuge-recalculate/route'),
  'viral-analyzer-worker': () => import('@/app/api/cron/viral-analyzer-worker/route'),
  'viral-discovery-weekly': () => import('@/app/api/cron/viral-discovery-weekly/route'),
  'content-factory-intake': () => import('@/app/api/cron/content-factory-intake/route'),
  'diagnostic-weekly': () => import('@/app/api/cron/diagnostic-weekly/route'),
  'kpi-backfill': () => import('@/app/api/cron/kpi-backfill/route'),
  'benchmark-accumulator': () => import('@/app/api/cron/benchmark-accumulator/route'),
  'cms-connection-retest': () => import('@/app/api/cron/cms-connection-retest/route'),
  'prescription-weekly': () => import('@/app/api/cron/prescription-weekly/route'),
  'prescription-launch-check': () => import('@/app/api/cron/prescription-launch-check/route'),
  'anomaly-detector': () => import('@/app/api/cron/anomaly-detector/route'),
  'daily-cron-digest': () => import('@/app/api/cron/daily-cron-digest/route'),
  'proposal-view-digest': () => import('@/app/api/cron/proposal-view-digest/route'),
  'agent-learning-rollup': () => import('@/app/api/cron/agent-learning-rollup/route'),
  'memory-extractor': () => import('@/app/api/cron/memory-extractor/route'),
  'site-audit-weekly': () => import('@/app/api/cron/site-audit-weekly/route'),
  'weekly-seo-report': () => import('@/app/api/cron/weekly-seo-report/route'),
  'pm-daily-todo': () => import('@/app/api/cron/pm-daily-todo/route'),
  'product-map-sync': () => import('@/app/api/cron/product-map-sync/route'),
  'blog-weekly': () => import('@/app/api/cron/blog-weekly/route'),
  'seo-patrol-daily': () => import('@/app/api/cron/seo-patrol-daily/route'),
  'social-comment-autoreply': () => import('@/app/api/cron/social-comment-autoreply/route'),
  'factory-publish-worker': () => import('@/app/api/cron/factory-publish-worker/route'),
  'factory-dead-letter-rerun': () => import('@/app/api/cron/factory-dead-letter-rerun/route'),
  'factory-order-scheduler': () => import('@/app/api/cron/factory-order-scheduler/route'),
  'factory-publish-sweeper': () => import('@/app/api/cron/factory-publish-sweeper/route'),
  'factory-worker-sweeper': () => import('@/app/api/cron/factory-worker-sweeper/route'),
  'messenger-sync-hourly': () => import('@/app/api/cron/messenger-sync-hourly/route'),
  'meta-leads-sync': () => import('@/app/api/cron/meta-leads-sync/route'),
  'ad-readback-sweep': () => import('@/app/api/cron/ad-readback-sweep/route'),
  'ad-entity-snapshot': () => import('@/app/api/cron/ad-entity-snapshot/route'),
  'mailchimp-activity-sync': () => import('@/app/api/cron/mailchimp-activity-sync/route'),
  'mailchimp-paid-tagging': () => import('@/app/api/cron/mailchimp-paid-tagging/route'),
  'mailchimp-suppression-sync': () => import('@/app/api/cron/mailchimp-suppression-sync/route'),
  'market-intel-daily': () => import('@/app/api/cron/market-intel-daily/route'),
  'cron-run-logs-cleanup': () => import('@/app/api/cron/cron-run-logs-cleanup/route'),
  'baseline-domains-monthly': () => import('@/app/api/cron/baseline-domains-monthly/route'),
}

export function dispatchLoaderRoutes(): string[] {
  return Object.keys(LOADERS)
}

export async function invokeDispatchJob(
  job: DispatchJob,
  secret: string,
): Promise<{ status: number; body: string }> {
  const load = LOADERS[job.route]
  if (!load) throw new Error(`no cron loader for ${job.route}`)
  const mod = await load()
  const handler = job.method === 'POST' ? mod.POST : mod.GET
  if (!handler) throw new Error(`${job.route} has no ${job.method}`)
  const url = new URL(`http://127.0.0.1/api/cron/${job.route}`)
  applyQuery(url, job.query)
  const req = new NextRequest(url, { method: job.method, headers: authHeaders(job, secret) })
  const res = await handler(req)
  const body = await res.text()
  return { status: res.status, body: body.slice(0, 500) }
}

function applyQuery(url: URL, query: string | undefined): void {
  if (!query) return
  new URLSearchParams(query).forEach((value, key) => {
    url.searchParams.set(key, value)
  })
}

function authHeaders(job: DispatchJob, secret: string): Headers {
  const headers = new Headers()
  if (job.auth === 'bearer') headers.set('authorization', `Bearer ${secret}`)
  else headers.set('x-cron-secret', secret)
  return headers
}
