import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GateList } from '../GateList'
import type { PhaseGateView } from '@/lib/marketing-plan/promo/board'
import type { GateResult } from '@/lib/marketing-plan/promo/gates'

const gate = (key: GateResult['key'], light: GateResult['light']): GateResult => ({
  key, group: 'content', label: key === 'ads.creative_approved' ? '投放素材已批准' : '广告日预算上限已设置',
  hard: true, light, reason: '原因', how: '办法', evidence: 'self_reported' as GateResult['evidence'], as_of: null,
})

const view = (results: GateResult[]): PhaseGateView => ({
  phase: { id: 'p1', name: '阶段 1', start_date: '2026-11-05', end_date: '2026-11-19' },
  results, worst: 'red', blockers: [], unverified: [],
})

const creatives = { clientId: 'c1', refs: ['v1'], canAct: true, onChanged: vi.fn() }

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ config: { creative_pool: [] }, labels: {} }) })))
}

describe('GateList 的素材一行', () => {
  it('素材这一行红灯、传了素材参数 → 展开「本计划用到的素材」', async () => {
    stubFetch()
    render(<GateList view={view([gate('ads.creative_approved', 'red')])} onVerify={vi.fn()} busyKey={null} creatives={creatives} />)
    expect(await screen.findByText(/本计划用到的素材/)).toBeTruthy()
  })

  it('素材这一行是绿灯 → 不展开', () => {
    stubFetch()
    render(<GateList view={view([gate('ads.creative_approved', 'green')])} onVerify={vi.fn()} busyKey={null} creatives={creatives} />)
    expect(screen.queryByText(/本计划用到的素材/)).toBeNull()
  })

  it('别的门红灯 → 不展开素材清单', () => {
    stubFetch()
    render(<GateList view={view([gate('ads.cap_set', 'red')])} onVerify={vi.fn()} busyKey={null} creatives={creatives} />)
    expect(screen.queryByText(/本计划用到的素材/)).toBeNull()
  })

  it('不传素材参数 → 保持只读（旧行为）', () => {
    stubFetch()
    render(<GateList view={view([gate('ads.creative_approved', 'red')])} onVerify={vi.fn()} busyKey={null} />)
    expect(screen.queryByText(/本计划用到的素材/)).toBeNull()
  })
})
