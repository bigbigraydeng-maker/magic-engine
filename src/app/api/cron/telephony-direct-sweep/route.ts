/**
 * Phone calls → CRM without Inngest. Knocked every 10 minutes by cron-dispatch-frequent (in-process, no extra Render
 * service). Logic and switch: lib/telephony/direct-sweep.ts. Receipt → cron_run_logs 'telephony-direct-sweep'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { directFallbackEnabled, runDirectTelephonySweep } from '@/lib/telephony/direct-sweep'
import { processRawEvent } from '@/lib/telephony/voipline/process'
import { supabaseTelephonyStore } from '@/lib/telephony/voipline/store'
import { supabaseSweepDeps } from '@/lib/inngest/functions/telephony-analysis'
import { runCallAnalysis } from '@/lib/telephony/transcribe/pipeline'
import { supabaseAnalysisStore } from '@/lib/telephony/transcribe/store'
import { deepseekAnalyzer, twilioTranscriber } from '@/lib/telephony/transcribe/vendors'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TELEPHONY_DIRECT_JOB = 'telephony-direct-sweep'

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const run = await startCronRun(TELEPHONY_DIRECT_JOB)
  if (!directFallbackEnabled(process.env)) {
    await run.finish({ processed: 0, completed: 0, summary: { status: 'off' } })
    return NextResponse.json({ status: 'off' })
  }
  try {
    const receipt = await runDirectTelephonySweep({
      store: supabaseTelephonyStore,
      processRaw: (id) => processRawEvent(supabaseTelephonyStore, id),
      analysisDeps: supabaseSweepDeps,
      analyse: (c) =>
        runCallAnalysis(
          { store: supabaseAnalysisStore, transcribe: twilioTranscriber, analyze: deepseekAnalyzer, env: (n) => process.env[n] },
          { clientId: c.client_id, provider: c.provider, providerCallId: c.provider_call_id },
        ),
    })
    const crm = receipt.crm
    const an = receipt.analysis
    const processed = (crm ? crm.rawRedispatched + crm.endedCallsRedispatched : 0) + (an?.candidates ?? 0)
    const failed = (crm?.processFailed ?? 0) + (an?.failed ?? 0)
    const errors = [crm?.firstError, an?.firstError].filter(Boolean).join(' | ')
    await run.finish({ processed, completed: processed - failed, failed, summary: { ...receipt }, ...(errors ? { error: errors } : {}) })
    return NextResponse.json(receipt)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await run.finish({ failed: 1, error: message.slice(0, 500) })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
