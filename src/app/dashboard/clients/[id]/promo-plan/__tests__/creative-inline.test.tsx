import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'client-1' }) }))

import { PromoPlanClient } from '../_client'
import { baseSpec, evaluatePhaseGates, goodFacts } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { blockers, unverified, worstLight } from '@/lib/marketing-plan/promo/gates'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 素材池里 vid-1 还是候选 → 「投放素材已批准」红灯。 */
function redBoard() {
  const spec = baseSpec()
  const results = evaluatePhaseGates(spec, spec.phases[0], goodFacts({
    config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ ref: 'vid-1', status: 'candidate' }] },
  }))
  const phase = spec.phases[0]
  return {
    spec,
    board: {
      plan_id: 'plan-1', plan_status: 'draft', updated_at: null, has_promo: true, spec_valid: true, issues: [],
      today: '2026-10-30', timezone_known: true, playbook: null, approval: null,
      next_phase: {
        phase: { id: phase.id, name: phase.name, start_date: phase.start_date, end_date: phase.end_date },
        results, worst: worstLight(results), blockers: blockers(results), unverified: unverified(results),
      },
      reconcile: null, reviewed_this_window: false, content_changed: false,
    },
  }
}

let boardLoads = 0
let poolStatus = 'candidate'
const posts: string[] = []

function installFetch(approverOnlyOnApprove = false) {
  const { spec, board } = redBoard()
  const plan = {
    id: 'plan-1', client_id: 'client-1', status: 'draft', title: 'CTS11月计划', plan_data: { promo: spec },
    generation_meta: null, updated_at: null, created_at: '2026-10-29T00:00:00Z',
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST') {
      posts.push(u)
      if (u.endsWith('/creative-pool/approve')) {
        if (approverOnlyOnApprove) return json({ error: 'Forbidden' }, 403)
        poolStatus = 'approved'
        return json({ success: true })
      }
      return json({ success: true })
    }
    if (u === '/api/clients/client-1/marketing-plan') return json({ success: true, plans: [plan], prescription: null })
    if (u === '/api/clients/client-1/marketing-plan/plan-1/promo') {
      boardLoads += 1
      return json({ success: true, board, options: null, live_ads: null, live_ads_visible: false, prescription: null })
    }
    if (u === '/api/clients/client-1/ad-strategy-config') {
      return json({ config: { creative_pool: [{ kind: 'meta_video', ref: 'vid-1', status: poolStatus, promo_window: { kind: 'evergreen' } }] } })
    }
    if (u.endsWith('/creative-pool/labels')) return json({ labels: {} })
    return json({}, 404)
  }))
}

beforeEach(() => { boardLoads = 0; poolStatus = 'candidate'; posts.length = 0; window.confirm = vi.fn(() => true) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('推广计划页：素材在同一页批准', () => {
  it('素材门红灯时，这一行下面直接列出本计划的素材，带批准按钮', async () => {
    installFetch()
    render(<PromoPlanClient />)
    expect(await screen.findByText(/本计划用到的素材/)).toBeTruthy()
    expect(screen.getByText('vid-1')).toBeTruthy()
    expect(await screen.findByRole('button', { name: '批准' })).toBeTruthy()
  })

  it('点批准后整张检查清单会重新读一遍（不用手动刷新）', async () => {
    installFetch()
    render(<PromoPlanClient />)
    const btn = await screen.findByRole('button', { name: '批准' })
    const before = boardLoads
    expect(before).toBeGreaterThanOrEqual(1)
    fireEvent.click(btn)
    await waitFor(() => expect(posts).toContain('/api/clients/client-1/ad-strategy-config/creative-pool/approve'))
    await waitFor(() => expect(boardLoads).toBeGreaterThan(before))
  })

  it('接口回 403：页面上说明需要内部账号，按钮灰', async () => {
    installFetch(true)
    render(<PromoPlanClient />)
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect(screen.getAllByText(/需要 Magic Lab 内部账号/).length).toBeGreaterThan(0)
  })
})
