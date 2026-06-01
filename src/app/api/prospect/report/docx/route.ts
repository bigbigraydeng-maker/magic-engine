/**
 * GET /api/prospect/report/docx
 *
 * Returns the latest completed prospect Discovery Report as a DOCX file.
 * Auth is validated via the Supabase session cookie created by the magic link.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateZhangqianDocx } from '@/lib/zhangqian/docx-generator'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

interface JobRow {
  id: string
  status: string
  result: unknown
  domain: string
  completed_at: string | null
  created_at: string
}

function isDiscoveryReport(value: unknown): value is DiscoveryReport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.domain === 'string' && typeof record.business === 'object' && record.business !== null
}

function filenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'discovery_report'
}

export async function GET(): Promise<NextResponse> {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, status, result, domain, completed_at, created_at')
    .eq('email', user.email.toLowerCase())
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<JobRow>()

  if (error) {
    console.error('[prospect/report/docx] db error', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if (!data || !isDiscoveryReport(data.result)) {
    return NextResponse.json({ error: 'No completed report found for your account.' }, { status: 404 })
  }

  const reportDate = new Date(data.completed_at ?? data.created_at).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const clientName = data.result.business.name || data.domain
  const buffer = await generateZhangqianDocx(data.result, clientName, reportDate)
  const filename = `magic_engine_discovery_${filenamePart(clientName)}_${(data.completed_at ?? data.created_at).slice(0, 10)}.docx`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
