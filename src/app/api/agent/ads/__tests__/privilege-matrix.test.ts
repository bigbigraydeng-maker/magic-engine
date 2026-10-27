import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { AGENT_ADS_DENY_TOOL, AGENT_ADS_SCOPE } from '@/lib/auth/agent-ads-scope'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { POST as approve } from '@/app/api/clients/[id]/marketing-plan/[planId]/approve/route'
import { PUT as savePromo } from '@/app/api/clients/[id]/marketing-plan/[planId]/promo/route'
import { POST as execute } from '@/app/api/clients/[id]/meta-ads/execute/route'
import { POST as writeMeta } from '@/app/api/clients/[id]/meta-ads/draft/route'
import { PATCH as changeCap } from '@/app/api/clients/[id]/ad-strategy-config/route'
import { GET as uploadAudience } from '@/app/api/admin/conversions/audience-export/route'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PLAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const RAW = 'me_live_fixturekey'
const from = vi.mocked(supabaseAdmin.from)

function install() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  from.mockImplementation((table: string) => {
    if (table === 'mcp_access_log') {
      return { insert } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: KEY,
          client_id: CLIENT,
          scopes: [AGENT_ADS_SCOPE],
          expires_at: '2099-01-01T00:00:00.000Z',
        },
        error: null,
      }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }
    return chain as unknown as ReturnType<typeof supabaseAdmin.from>
  })
  return insert
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${RAW}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ads-agent key on privileged routes', () => {
  const cases: Array<{ name: string; code: string; run: () => Promise<Response> }> = [
    {
      name: 'approve',
      code: 'approve',
      run: () => approve(jsonRequest('http://localhost/approve', 'POST', {}), { params: { id: CLIENT, planId: PLAN } }),
    },
    {
      name: 'launch',
      code: 'launch',
      run: () => execute(
        jsonRequest('http://localhost/execute', 'POST', { action_type: 'ads.reactivate_campaign', campaign_id: 'c1' }),
        { params: { id: CLIENT } },
      ),
    },
    {
      name: 'change_budget',
      code: 'change_budget',
      run: () => execute(
        jsonRequest('http://localhost/execute', 'POST', { action_type: 'ads.adjust_bid', campaign_id: 'c1' }),
        { params: { id: CLIENT } },
      ),
    },
    {
      name: 'change_budget_on_promo_save',
      code: 'change_budget',
      run: () => savePromo(jsonRequest('http://localhost/promo', 'PUT', { promo: {} }), { params: { id: CLIENT, planId: PLAN } }),
    },
    {
      name: 'change_cap',
      code: 'change_cap',
      run: () => changeCap(
        jsonRequest('http://localhost/config', 'PATCH', { daily_budget_cap_cents: 100 }),
        { params: { id: CLIENT } },
      ),
    },
    {
      name: 'upload_audience',
      code: 'upload_audience',
      run: () => uploadAudience(new Request(`http://localhost/export?client_id=${CLIENT}`, {
        headers: { authorization: `Bearer ${RAW}` },
      })),
    },
    {
      name: 'write_meta',
      code: 'write_meta',
      run: () => writeMeta(
        jsonRequest('http://localhost/draft', 'POST', { name: 'x' }),
        { params: Promise.resolve({ id: CLIENT }) },
      ),
    },
  ]

  it.each(cases)('$name returns 403 and writes a denial row', async ({ code, run }) => {
    const insert = install()
    const res = await run()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe(code)
    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0][0] as Record<string, unknown>
    expect(row).toMatchObject({
      tool: AGENT_ADS_DENY_TOOL,
      ok: false,
      error_code: code,
      client_key_id: KEY,
      key_kind: 'client',
    })
    expect(JSON.stringify(row)).not.toContain(RAW)
  })
})

describe('agent route sources', () => {
  it('does not import a Meta write module', () => {
    const roots = [
      path.join(process.cwd(), 'src/app/api/agent'),
      path.join(process.cwd(), 'src/lib/marketing-plan/agent-draft.ts'),
      path.join(process.cwd(), 'src/lib/marketing-plan/agent-draft-store.ts'),
      path.join(process.cwd(), 'src/lib/marketing-plan/agent-draft-parse.ts'),
      path.join(process.cwd(), 'src/lib/auth/agent-ads-call.ts'),
      path.join(process.cwd(), 'src/lib/auth/agent-ads-key-issue.ts'),
    ]
    const banned = ['setCampaignStatus', 'createDraftForApproval', 'campaign-writes', 'ad-publisher', 'draft-and-gate', 'ads-campaign-budget']
    const files = roots.flatMap(root => listFiles(root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const word of banned) expect(source, file).not.toContain(word)
    }
  })
})

function listFiles(target: string): string[] {
  if (target.includes(`${path.sep}__tests__${path.sep}`)) return []
  const info = statSync(target)
  if (info.isFile()) return target.endsWith('.ts') && !target.endsWith('.test.ts') ? [target] : []
  return readdirSync(target)
    .filter(name => name !== '__tests__')
    .flatMap(name => listFiles(path.join(target, name)))
}
