import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebIntelligencePanel } from '../WebIntelligencePanel'

const clients = { clients: [{ id: 'a', name: 'Client A' }, { id: 'b', name: 'Client B' }] }
const baseCompetitor = { domain: 'example.com', tier: 'core', status: 'active', sources: ['legacy'], tags: [], urls: ['https://example.com/tours/'], interval_hours: 24 }
const payload = (id = 'a') => ({
  client: { id, name: `Client ${id.toUpperCase()}` }, settings: null,
  competitors: [baseCompetitor], signals: [], evidence: [], runs: [],
  brief: {
    as_of: '2026-09-10T00:00:00Z', subject: 'Tour', headline: '现有数据还不足以回答 9 月应该争哪条线路、用什么价格。',
    summary: '当前 1/4 个维度可直接竞争对比，1 个只有单方或有限数据；监控 1 家竞品、1 个业务页面。',
    actions: ['补齐竞品核心 Tour 列表与详情页。', '绑定评价平台身份。', '只对已验证变化形成建议。'],
    warnings: [], gaps: [{ label: '竞品广告', reason: '尚未形成可比较的历史快照' }],
    product_scope: { status: 'unknown', market_ids: [], labels: [], basis: [], source: '尚无可靠范围', rule_version: 'travel-market-v1', applies: false, evidence_status: 'available' },
    dimensions: [
      { key: 'product', label: '竞品产品与价格', status: 'limited', headline: '已读取 1/1 个已配置业务页面', detail: 'Tour 盘面', source: '竞品官网已配置页面', observed_at: '2026-09-10', coverage: '仅代表已配置页面。' },
      { key: 'search', label: '网站搜索基础', status: 'ready', headline: 'Client A 26；example.com 22', detail: '不等于 Google 排名、流量或市场份额。', source: 'Industry Baseline', observed_at: '2026-09-01', coverage: '2 个网站。' },
      { key: 'reputation', label: '客户评价', status: 'unconfigured', headline: '尚未形成可比较的评价', detail: '明确身份', source: 'Google', observed_at: null, coverage: '未配置。' },
      { key: 'ai_visibility', label: 'AI 推荐表现', status: 'no_observation', headline: '尚无快照', detail: '只展示客户自身表现', source: 'AI Visibility', observed_at: null, coverage: '尚无记录。' },
    ],
  },
  budget: { accounted_nzd: 3, reserved_nzd: 2 }, can_edit: true, can_run: true,
})
const response = (data: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data } as Response)
async function selectClient(id = 'a') {
  await screen.findByRole('option', { name: 'Client A' })
  fireEvent.change(screen.getByLabelText('客户'), { target: { value: id } })
}
function openSection(name: string) { fireEvent.click(screen.getByText(name)) }
afterEach(() => vi.unstubAllGlobals())

describe('WebIntelligencePanel competition brief flow', () => {
  it('puts the current decision ahead of product evidence and configuration', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : payload())))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('目前还没有可查看的竞争变化')).toBeVisible()
    expect(screen.getByText('还没有可用的竞争分析')).toBeVisible()
    expect(screen.getByText('查看完整产品盘面与数据限制')).toBeVisible()
    openSection('查看完整产品盘面与数据限制')
    expect(screen.getByText('Tour 竞争盘面')).toBeVisible()
    expect(screen.getByText('查看其他判断依据与数据缺口')).toBeVisible()
    expect(screen.queryByText('四个经营维度')).not.toBeInTheDocument()
    openSection('重新采集与系统运行说明')
    expect(screen.getByRole('button', { name: '开始竞争分析' })).toBeVisible()
    expect(screen.getByText('本次将分析 1 家竞品、1 个页面')).toBeVisible()
    expect(screen.getByText('还没有可用的竞争分析')).toBeVisible()
    expect(screen.getByLabelText('开启监控')).not.toBeVisible()
    openSection('成本、运行记录与证据')
    expect(screen.getByLabelText('开启监控')).not.toBeChecked()
  })

  it('queues configured pages in core-first order and retries only the failed identity', async () => {
    const data = { ...payload(), competitors: [
      { ...baseCompetitor, domain: 'watch.example', tier: 'watch', urls: ['https://watch.example/tours/'] },
      baseCompetitor,
    ] }
    const ids = ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011']
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ids.shift()) })
    let posts = 0
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/clients') return response(clients)
      if (init?.method === 'POST') return ++posts === 2 ? response({ error: 'Monthly hard stop reached' }, false) : response({ status: 'queued', request_id: JSON.parse(init.body as string).request_id })
      return response(data)
    })
    vi.stubGlobal('fetch', fetcher)
    render(<WebIntelligencePanel />); await selectClient()
    fireEvent.click(await screen.findByText('重新采集与系统运行说明'))
    fireEvent.click(await screen.findByRole('button', { name: '开始竞争分析' }))
    expect(await screen.findByText(/1\/2 个页面已开始，1 个页面/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续未完成页面' }))
    await waitFor(() => expect(posts).toBe(3))
    expect(screen.getByRole('button', { name: '开始新一轮竞争分析' })).toBeVisible()
    const bodies = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string))
    expect(bodies[0].domain).toBe('example.com')
    expect(bodies[1].request_id).toBe(bodies[2].request_id)
  })

  it('does not present an old signal as the result of a newer unchanged run', async () => {
    const data = { ...payload(), runs: [{
      id: 'new-run', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null,
      created_at: '2026-09-10T01:00:00Z', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0,
    }], signals: [{
      id: 'old-signal', run_id: 'old-run', domain: 'example.com', kind: 'business_page_changed', before_evidence_id: null, after_evidence_id: null,
      interpretation_status: 'complete', classification: 'threat', interpretation: { summary: 'Old misleading conclusion' }, recommended_action: 'Old action', created_at: '2026-09-09T01:00:00Z',
    }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次没有发现需要调衡的竞争变化')).toBeVisible()
    expect(screen.getByText('本次监控覆盖：1/1 个页面证据有效')).toBeVisible()
    expect(screen.queryByText('Old misleading conclusion')).not.toBeInTheDocument()
    openSection('历史分析 · 1 条')
    expect(screen.queryByText('Old misleading conclusion')).not.toBeInTheDocument()
    expect(screen.getByText('模型结论没有形成完整的前后证据链，当前不能作为经营决定。')).toBeVisible()
  })

  it('shows current evidence as Inspect, Measure and Prescribe without claiming execution', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: $1,200 | Availability: Available', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: $950 | Availability: Only 3 spaces left', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary: '竞品降价并接近售罄。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '比较同类产品价值，并决定是否调整优惠。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('竞品降价并接近售罄。')).toBeVisible()
    expect(screen.getByText('对 Client A 的意义')).toBeVisible()
    expect(screen.getByText('这周下一步')).toBeVisible()
    expect(screen.getByText(/当前判断 · 仅代表这个竞品的这个页面 · 尚未执行任何动作/)).toBeVisible()
    fireEvent.click(screen.getByText('查看变化依据'))
    expect(screen.getByText('+ Tour: Wonders of China | Price: $950 | Availability: Only 3 spaces left')).toBeVisible()
    expect(screen.getByText('− Tour: Wonders of China | Price: $1,200 | Availability: Available')).toBeVisible()
  })

  it('presents a relevant full-page China price change as a comparison decision', async () => {
    const run = { id: 'current', domain: 'wendywutours.co.nz', url: 'https://wendywutours.co.nz/china/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const page = (price: string) => ['Classic Group Tour', 'Classic China', `22 days from ${price}`, '44 Reviews', 'Includes international airfares', 'Beijing - Xian - Shanghai'].join('\n')
    const data = { ...payload(), competitors: [{ ...baseCompetitor, domain: run.domain, urls: [run.url] }], brief: { ...payload().brief, product_scope: { status: 'inferred', market_ids: ['china'], labels: ['中国'], basis: ['china tours'], source: '主关键词', rule_version: 'travel-market-v1', applies: true, evidence_status: 'available' } }, runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: page('$10,080pp'), observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: page('$10,580pp'), observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'ignore', interpretation: { summary: 'Wendy Wu 的 Classic China 22 天产品每人上涨 $500。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '无需采取行动。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('需要同类对比')).toBeVisible()
    expect(screen.getByText('分析范围：中国团')).toBeVisible()
    expect(screen.getByText(/请先找出 Client A 最接近的线路/)).toBeVisible()
    expect(screen.queryByText('业务相关性待确认')).not.toBeInTheDocument()
    expect(screen.getByText(/china tours/)).not.toBeVisible()
    fireEvent.click(screen.getByText(/分析范围：中国团/))
    expect(screen.getByText(/判断依据：主关键词/)).toBeVisible()
  })

  it('removes a clearly foreign Tour change from the client decision and keeps the record', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), brief: { ...payload().brief, product_scope: { status: 'inferred', market_ids: ['china'], labels: ['中国'], basis: ['cts china'], source: '主关键词', rule_version: 'travel-market-v1', applies: true, evidence_status: 'available' } }, runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Malaysia & Singapore | Price: $10,430', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Malaysia & Singapore | Price: $10,730', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'opportunity', interpretation: { summary: '竞品涨价，可能形成机会。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '立即调整 CTS 中国团价格。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('本次采集尚未找到匹配产品变化')).toBeVisible()
    expect(screen.queryByText('立即调整 CTS 中国团价格。')).not.toBeInTheDocument()
    openSection('当前业务范围外 · 1 条')
    expect(screen.getByText('已从 Client A 当前经营判断中排除')).toBeVisible()
    expect(screen.getByText(/马来西亚、新加坡/)).toBeVisible()
  })

  it('withholds actions when the client product scope is unavailable', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), brief: { ...payload().brief, product_scope: { ...payload().brief.product_scope, applies: true, evidence_status: 'failed' } }, runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: $1,200', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: $950', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'opportunity', interpretation: { summary: '竞品降价。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '立即调价。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('客户产品范围读取失败，本页暂不提供经营行动建议。')).toBeVisible()
    expect(screen.queryByText('立即调价。')).not.toBeInTheDocument()
  })

  it('withholds a model conclusion when its evidence chain is incomplete', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Price $1,200', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Price $950', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'opportunity', interpretation: { summary: '竞品降价。', confidence: 0.8, evidence_ids: ['before'] }, recommended_action: '立即降价。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('待核实')).toBeVisible()
    expect(screen.getByText('模型结论没有形成完整的前后证据链，当前不能作为经营决定。')).toBeVisible()
    expect(screen.queryByText('立即降价。')).not.toBeInTheDocument()
  })

  it('withholds an otherwise grounded conclusion when the evidence is stale', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-01', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Price $1,200', observed_at: '2026-08-30', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Price $950', observed_at: '2026-09-01', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary: '竞品降价。', confidence: 0.8, evidence_ids: ['before', 'after'] }, recommended_action: '立即降价。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('这条观察已超过 8 天，请重新采集后再决定。')).toBeVisible()
    expect(screen.queryByText('立即降价。')).not.toBeInTheDocument()
  })

  it('keeps a model price claim absent from evidence as a lead without exposing its action', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour A old package', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour A revised package', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'opportunity', interpretation: { summary: 'Tour A 已降价至 $950。', confidence: 0.7, evidence_ids: ['before', 'after'] }, recommended_action: '核对 CTS 同类产品。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('Tour A 已降价至 $950。')).toBeVisible()
    expect(screen.getByText('模型发现了一条待核实线索')).toBeVisible()
    expect(screen.queryByText('核对 CTS 同类产品。')).not.toBeInTheDocument()
    expect(screen.queryByText(/没有提取到明确的价格/)).not.toBeInTheDocument()
  })

  it('withholds an action when model prices and direction conflict with same-category evidence', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour A price NZD 5,000', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour A price NZD 4,500', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary: 'Tour A 从 NZD 9,000 涨价到 NZD 12,000。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '跟随涨价。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('模型发现了一条待核实线索')).toBeVisible()
    expect(screen.queryByText('跟随涨价。')).not.toBeInTheDocument()
    expect(screen.getByText('Tour A 从 NZD 9,000 涨价到 NZD 12,000。')).toBeVisible()
  })

  it('withholds an action when correct prices are assigned to the wrong before-and-after direction', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: NZD 5,000', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: NZD 4,500', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary: 'Wonders of China 从 NZD 4,500 降价至 NZD 5,000。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '立即跟进。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('模型发现了一条待核实线索')).toBeVisible()
    expect(screen.queryByText('立即跟进。')).not.toBeInTheDocument()
  })

  it.each([
    'Wonders of China 每人下跌 NZD 500。',
    'Wonders of China 涨价至 NZD 500。',
    'Wonders of China 当前价格 NZD 5,000。',
    'Wonders of China 从 NZD 500 涨价至 NZD 5,500。',
    'Wonders of China 从 NZD 5,000 上涨 NZD 5,500。',
    'Wonders of China 价格 NZD 500。',
    'Wonders of China 从 NZD 5,000 到 NZD 5,500，当前价格 NZD 500。',
    'Wonders of China 价格从 5500 降到 5000。',
  ])('withholds a misleading single-amount price claim: %s', async summary => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: NZD 5,000', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: NZD 5,500', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary, confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '立即调价。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('模型发现了一条待核实线索')).toBeVisible()
    expect(screen.queryByText('立即调价。')).not.toBeInTheDocument()
  })

  it('does not expose a pricing action before a scoped Tour has a client comparator', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const scoped = { ...payload().brief, product_scope: { status: 'inferred' as const, market_ids: ['china'], labels: ['中国'], basis: ['china tours'], source: '主关键词' as const, rule_version: 'travel-market-v1' as const, applies: true, evidence_status: 'available' as const } }
    const data = { ...payload(), brief: scoped, runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: NZD 5,000', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: NZD 5,500', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'opportunity', interpretation: { summary: 'Wonders of China 从 NZD 5,000 涨价至 NZD 5,500。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: 'CTS 立即涨价 NZD 300。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('建议先核对')).toBeVisible()
    expect(screen.getByText(/请先找出 Client A 最接近的线路/)).toBeVisible()
    expect(screen.queryByText('CTS 立即涨价 NZD 300。')).not.toBeInTheDocument()
  })

  it('does not pair prices from different tours through a generic shared word', async () => {
    const run = { id: 'current', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0.02, accounted_nzd: 0.05, reserved_nzd: 0 }
    const data = { ...payload(), runs: [run], evidence: [
      { id: 'before', source_url: run.url, excerpt: 'Tour: China Tour A | Duration: 10 days | Promotion: none | Reviews: 20 | Price: NZD 5,000', observed_at: '2026-09-08', content_hash: 'a' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Japan Tour B | Duration: 10 days | Promotion: none | Reviews: 20 | Price: NZD 4,500', observed_at: '2026-09-09', content_hash: 'b' },
    ], signals: [{ id: 'decision', run_id: run.id, domain: run.domain, kind: 'business_page_changed', before_evidence_id: 'before', after_evidence_id: 'after', interpretation_status: 'complete', classification: 'threat', interpretation: { summary: 'China Tour A 从 NZD 5,000 降价至 NZD 4,500。', confidence: 0.9, evidence_ids: ['before', 'after'] }, recommended_action: '立即跟进。', created_at: run.created_at }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('模型发现了一条待核实线索')).toBeVisible()
    expect(screen.queryByText('立即跟进。')).not.toBeInTheDocument()
  })

  it('does not present an old unchanged run as the current market state', async () => {
    const data = { ...payload(), runs: [{ id: 'old-run', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-08-20', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0 }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次证据已过期，请重新采集')).toBeVisible()
    expect(screen.getByText('旧记录只能说明当时没有发现变化，不能代表当前竞争盘面。')).toBeVisible()
    expect(screen.getByText(/0\/1 个页面证据有效 · 1 个已过期/)).toBeVisible()
    expect(screen.queryByText(/没有发现需要调衡/)).not.toBeInTheDocument()
  })

  it('reports partial coverage instead of a safe conclusion', async () => {
    const data = { ...payload(), runs: [{ id: 'failed', domain: 'example.com', url: 'https://example.com/tours/', status: 'failed', provider_status: 'FAILED', error_code: 'capture_invalid', created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0 }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次覆盖不足，暂不能下结论')).toBeVisible()
    expect(screen.getByText(/1 个未完成/)).toBeVisible()
  })

  it('does not call a partially observed watchlist safe', async () => {
    const data = { ...payload(), competitors: [baseCompetitor, { ...baseCompetitor, domain: 'unseen.example', urls: ['https://unseen.example/tours/'] }], runs: [{ id: 'done', domain: 'example.com', url: 'https://example.com/tours/', status: 'complete', provider_status: 'SUCCEEDED', error_code: null, created_at: '2026-09-10', capture_cost_usd: 0.01, interpretation_cost_usd: 0, accounted_nzd: 0.02, reserved_nzd: 0 }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/clients' ? clients : data)))
    render(<WebIntelligencePanel />); await selectClient()
    expect(await screen.findByText('最近一次覆盖不足，暂不能下结论')).toBeVisible()
    expect(screen.getByText(/1 个尚未运行/)).toBeVisible()
    expect(screen.queryByText('最近一次没有发现需要调衡的竞争变化')).not.toBeInTheDocument()
  })

  it('clears one client private result while another client is loading', async () => {
    let resolveA!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/clients') return response(clients)
      if (url.includes('/a/')) return new Promise<Response>(resolve => { resolveA = resolve })
      return response({ ...payload('b'), competitors: [{ ...baseCompetitor, domain: 'private-b.example', urls: [] }] })
    }))
    render(<WebIntelligencePanel />); await selectClient(); await selectClient('b')
    await screen.findByText('Client B · 竞争监控'); openSection('管理监控范围'); await screen.findByText('private-b.example')
    await act(async () => resolveA(await response(payload())))
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
  })
})
