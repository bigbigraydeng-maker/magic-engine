/**
 * POST /api/agent/ads/clients/[id]/keys
 * Internal staff issue one ads:plan-draft key. Plaintext is in this response only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import {
  agentKeyIssueBlocked,
  clientExists,
  isClientUuid,
  issueAgentAdsKey,
  parseAgentAdsKeyIssue,
} from '@/lib/auth/agent-ads-key-issue'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (crossOrigin(req)) return json(403, '跨站请求不允许', 'cross_origin')
  const clientId = params.id
  if (!isClientUuid(clientId)) return json(400, '客户编号不正确', 'invalid_client')
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return json(admin.status, admin.error, 'forbidden')
  const parsed = parseAgentAdsKeyIssue(await readJson(req), Date.now())
  if (!parsed.ok) return json(parsed.status, parsed.error, parsed.code)
  const exists = await clientExists(clientId)
  if (exists === 'error') return json(500, '发钥匙失败', 'issue_failed')
  if (!exists) return json(404, '客户不存在', 'client_missing')
  const issued = await issueAgentAdsKey({
    clientId,
    name: parsed.name,
    expiresAt: parsed.expiresAt,
    createdByEmail: admin.user.email ?? null,
  })
  if (!issued) return json(500, '发钥匙失败', 'issue_failed')
  return NextResponse.json(
    { success: true, key: { ...issued.key, plaintext: issued.plaintext } },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

function crossOrigin(req: NextRequest): boolean {
  let requestHost: string | null = null
  try {
    requestHost = new URL(req.url).host
  } catch {
    requestHost = null
  }
  return agentKeyIssueBlocked({
    origin: req.headers.get('origin'),
    forwardedHost: req.headers.get('x-forwarded-host'),
    requestHost,
  })
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function json(status: number, error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { 'Cache-Control': 'no-store' } })
}
