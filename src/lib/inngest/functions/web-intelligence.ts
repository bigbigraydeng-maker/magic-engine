import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin as db } from '@/lib/supabase'
import { allowedClient, requestSchema } from '@/lib/web-intelligence/contracts'
import { readRun } from '@/lib/web-intelligence/store'
import { loadCompetitors } from '@/lib/web-intelligence/targets'
import { authorize, startCapture, collectCapture, stopUnfinishedCapture, understand, settle } from '@/lib/web-intelligence/runner'
import { discoverTourDetailRequests } from '@/lib/web-intelligence/detail-discovery'
import { collectAndRecordTrafficDirectionObservations } from '@/lib/web-intelligence/external-run'

export const WEB_CAPTURE_EVENT = 'web_intelligence.website.capture.requested'
export const webIntelligenceCapture = inngest.createFunction({
  id: `${CLOUD_FN_PREFIX}web-intelligence-capture`, retries: 2,
  concurrency: { limit: 1, key: 'event.data.client_id' },
}, { event: WEB_CAPTURE_EVENT }, async ({ event, step }) => {
  const req = requestSchema.parse(event.data)
  const run = await step.run('authorize-and-reserve', () => authorize(req))
  if (['complete', 'failed'].includes(run.status)) return { request_id: run.id, status: run.status, no_execute: true }
  const providerId = await step.run('start-or-resume-capture', () => startCapture(run))
  if (!providerId) return { request_id: run.id, status: (await step.run('start-status', () => readRun(run.id, run.client_id))).status, no_execute: true }
  for (let i = 0; i < 12; i++) {
    const state = await step.run(`collect-${i}`, () => collectCapture(run, providerId))
    if (state === 'failed') return { request_id: run.id, status: (await step.run('capture-status', () => readRun(run.id, run.client_id))).status, no_execute: true }
    if (state === 'captured') {
      const detailRequests = await step.run('discover-tour-details', () => discoverTourDetailRequests(run))
      if (detailRequests.length) {
        await step.sendEvent('queue-tour-details', detailRequests.map(request => ({ id: request.request_id, name: WEB_CAPTURE_EVENT, data: request })))
      }
      await step.run('understand-and-recommend', () => understand(run))
      const receipt = await step.run('settle-known-costs', () => settle(run.id, run.client_id))
      return { request_id: run.id, status: receipt.status, no_execute: true }
    }
    await step.sleep(`wait-${i}`, '20s')
  }
  await step.run('stop-and-reconcile', () => stopUnfinishedCapture(run, providerId))
  return { request_id: run.id, status: 'reconciliation', no_execute: true }
})

/** Existing Inngest owns the schedule. Unconfigured clients produce no work. */
export const webIntelligenceDue = inngest.createFunction({
  id: `${CLOUD_FN_PREFIX}web-intelligence-due`, retries: 1,
}, { cron: 'TZ=Pacific/Auckland 0 6 * * *' }, async ({ step }) => {
  const clients = await step.run('enabled-clients', async () => {
    if (!process.env.WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS) return []
    const r = await db.from('web_intelligence_settings').select('client_id').eq('enabled', true).eq('entitled', true)
    if (r.error) throw new Error('settings_read_failed')
    return r.data.map(row => row.client_id as string).filter(allowedClient)
  })
  for (const clientId of clients) {
    const due = await step.run(`due-${clientId}`, () => dueTargets(clientId))
    if (due.length) await step.sendEvent(`dispatch-${clientId}`, due.map(target => ({ id: target.id, name: WEB_CAPTURE_EVENT, data: { client_id: clientId, request_id: target.id, domain: target.domain, url: target.url } })))
  }
  return { clients_checked: clients.length, no_execute: true }
})

/**
 * Monthly, dark-by-default traffic direction collection. Public estimates
 * are intentionally separate from website captures so their lower trust and
 * different cadence cannot silently change the existing competitor workflow.
 */
export const webIntelligenceTrafficDue = inngest.createFunction({
  id: `${CLOUD_FN_PREFIX}web-intelligence-traffic-due`, retries: 1,
}, { cron: 'TZ=Pacific/Auckland 0 3 1 * *' }, async ({ step }) => {
  if (process.env.WEB_INTELLIGENCE_TRAFFIC_ENABLED !== 'true') return { skipped: 'disabled', clients_checked: 0, no_execute: true }
  const clients = await step.run('enabled-traffic-clients', async () => {
    if (!process.env.WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS) return []
    const r = await db.from('web_intelligence_settings').select('client_id').eq('enabled', true).eq('entitled', true)
    if (r.error) throw new Error('settings_read_failed')
    return r.data.map(row => row.client_id as string).filter(allowedClient)
  })
  const results: Array<{ client_id: string; domains: number; persisted: number; duplicates: number; write_failures: number; cost_usd: number; error?: string }> = []
  for (const clientId of clients) {
    const result = await step.run(`traffic-${clientId}`, async () => {
      try {
        const competitors = await loadCompetitors(clientId)
        const domains = [...new Set(competitors.filter(item => item.status !== 'archive').map(item => item.domain).filter(Boolean))].slice(0, 20)
        if (!domains.length) return { client_id: clientId, domains: 0, persisted: 0, duplicates: 0, write_failures: 0, cost_usd: 0 }
        const receipt = await collectAndRecordTrafficDirectionObservations({ clientId, domains, observedAt: new Date().toISOString(), maxChargeUsd: 0.15 })
        return { client_id: clientId, domains: domains.length, persisted: receipt.persisted, duplicates: receipt.duplicates, write_failures: receipt.writeFailures, cost_usd: receipt.costUsd ?? 0, error: receipt.error }
      } catch (error) {
        return { client_id: clientId, domains: 0, persisted: 0, duplicates: 0, write_failures: 0, cost_usd: 0, error: error instanceof Error ? error.message : String(error) }
      }
    })
    results.push(result)
  }
  return { skipped: null, clients_checked: clients.length, results, no_execute: true }
})
async function dueTargets(clientId: string) {
  const competitors = await loadCompetitors(clientId)
  const due: Array<{ id: string; domain: string; url: string }> = []
  for (const competitor of competitors.filter(c => c.status !== 'archive' && c.urls.length).sort((a, b) => Number(b.tier === 'core') - Number(a.tier === 'core'))) {
    for (const url of competitor.urls) {
      const last = await db.from('web_intelligence_runs').select('id,created_at,status,capture_claimed').eq('client_id', clientId).eq('domain', competitor.domain).eq('url', url).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (last.error) throw new Error('run_read_failed')
      if (last.data?.status === 'reserved' && !last.data.capture_claimed) {
        due.push({ id: last.data.id, domain: competitor.domain, url }); continue
      }
      if (last.data && (!['complete', 'failed'].includes(last.data.status) || Date.now() - Date.parse(last.data.created_at) < competitor.interval_hours * 3600000)) continue
      due.push({ id: randomUUID(), domain: competitor.domain, url })
    }
  }
  return due
}
