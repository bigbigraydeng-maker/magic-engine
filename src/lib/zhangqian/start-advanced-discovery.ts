import type { SupabaseClient } from '@supabase/supabase-js'
import { runZhangqianAdvanced } from '@/lib/zhangqian/advanced-agent'
import {
  createDiscoveryJob,
  failJob,
  getLatestDiscovery,
  mergeAdvancedPayload,
  updateJobProgress,
} from '@/lib/zhangqian/persistor'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

type StartAdvancedDiscoveryOptions = {
  triggeredBy: string
  siteUrl?: string
}

type StartAdvancedDiscoveryResult = {
  jobId: string
  domain: string
}

type ClientRecord = {
  id: string
  domain: string
}

type ExecuteAdvancedDiscoveryJobParams = {
  jobId: string
  clientId: string
  domain: string
  basicReport: DiscoveryReport
  triggeredBy: string
  siteUrl?: string
}

export class StartAdvancedDiscoveryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function startAdvancedDiscovery(
  supabase: SupabaseClient,
  clientId: string,
  options: StartAdvancedDiscoveryOptions,
): Promise<StartAdvancedDiscoveryResult> {
  const client = await loadClientRecord(supabase, clientId)
  const basicDiscovery = await getLatestDiscovery(supabase, clientId).catch(() => null)
  if (!basicDiscovery) {
    throw new StartAdvancedDiscoveryError(
      409,
      'No basic discovery found. Run the basic discovery first.',
    )
  }

  const jobId = await createDiscoveryJob(supabase, clientId, client.domain, 'advanced')

  void executeAdvancedDiscoveryJob(supabase, {
    jobId,
    clientId,
    domain: client.domain,
    basicReport: basicDiscovery.payload,
    triggeredBy: options.triggeredBy,
    siteUrl: options.siteUrl,
  }).catch((err: unknown) => {
    console.error('[zhangqian/start-advanced-discovery] background failure', err)
  })

  return { jobId, domain: client.domain }
}

async function loadClientRecord(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientRecord> {
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', clientId)
    .single<ClientRecord>()

  if (error || !client) {
    throw new StartAdvancedDiscoveryError(404, 'Client not found')
  }
  if (!client.domain) {
    throw new StartAdvancedDiscoveryError(400, 'Client has no domain configured')
  }

  return client
}

async function executeAdvancedDiscoveryJob(
  supabase: SupabaseClient,
  params: ExecuteAdvancedDiscoveryJobParams,
): Promise<void> {
  const { jobId, clientId, domain, basicReport, triggeredBy, siteUrl } = params

  await updateJobProgress(supabase, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    progress_note: 'Advanced discovery started.',
  })

  try {
    const advancedPayload = await runZhangqianAdvanced(
      domain,
      basicReport,
      triggeredBy,
      async (note) => {
        await updateJobProgress(supabase, jobId, { progress_note: note })
      },
      siteUrl,
      clientId,
    )

    await mergeAdvancedPayload(supabase, clientId, advancedPayload)
    await supabase
      .from('client_discovery_jobs')
      .update({
        status: 'completed',
        progress_note: 'Advanced discovery complete.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await failJob(supabase, jobId, `Advanced discovery error: ${message}`)
  }
}
