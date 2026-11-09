// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), claim: vi.fn(), read: vi.fn(), update: vi.fn(), reserve: vi.fn(), settle: vi.fn(), input: vi.fn(), signal: vi.fn(), rpc: vi.fn(), eligible: vi.fn(), dns: vi.fn(), interpret: vi.fn(), validate: vi.fn() }))
vi.mock('@/lib/apify/website', () => ({ startWebsiteCapture: mocks.start, getWebsiteCapture: mocks.get }))
vi.mock('@/lib/apify/client', () => ({ abortRun: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))
vi.mock('../targets', () => ({ assertEligibleTarget: mocks.eligible, validatePublicTarget: mocks.dns }))
vi.mock('../store', () => ({ claim: mocks.claim, readRun: mocks.read, updateRun: mocks.update, reserve: mocks.reserve, settle: mocks.settle, loadInterpretationInput: mocks.input, updateSignal: mocks.signal }))
vi.mock('../interpret', () => ({ interpretChange: mocks.interpret, validateInterpretation: mocks.validate, interpretationPrompt: vi.fn(), INTERPRETATION_MODEL: 'test', PROMPT_VERSION: 'v1' }))
import { authorize, startCapture, collectCapture, guardInterpretationByProductScope, understand, normaliseContent } from '../runner'
import type { Run, CaptureRequest } from '../contracts'
const id = '00000000-0000-4000-8000-000000000001'
const run = { id, client_id: id, domain: 'example.com', url: 'https://example.com/', actor_build: '1.2.3', capture_limit_usd: 0.1, provider_run_id: null } as Run
const req = { client_id: id, request_id: id, domain: run.domain, url: run.url } as CaptureRequest
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS', id)
  mocks.read.mockResolvedValue(run); mocks.claim.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ error: null, data: {} })
  mocks.eligible.mockResolvedValue({ tags: [] })
  mocks.start.mockResolvedValue({ id: 'provider1', defaultDatasetId: 'dataset1', status: 'RUNNING' })
})
describe('durable provider boundaries', () => {
  it('refuses unapproved clients before DNS, reserve or provider calls', async () => {
    vi.stubEnv('WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS', '')
    await expect(authorize(req)).rejects.toThrow('rollout')
    expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.dns).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled()
  })
  it('refuses a removed or archived identity before reserving budget', async () => {
    mocks.eligible.mockRejectedValue(new Error('target_not_eligible'))
    await expect(authorize(req)).rejects.toThrow(); expect(mocks.reserve).not.toHaveBeenCalled()
  })
  it('resumes a persisted provider run without starting another', async () => {
    mocks.read.mockResolvedValue({ ...run, provider_run_id: 'existing' })
    expect(await startCapture(run)).toBe('existing'); expect(mocks.start).not.toHaveBeenCalled()
  })
  it('holds uncertainty when a claimed start has no run receipt', async () => {
    mocks.claim.mockResolvedValue(false)
    expect(await startCapture(run)).toBeNull(); expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(id, id, expect.objectContaining({ status: 'reconciliation' }))
  })
  it('rechecks the configured target after claiming budget', async () => {
    mocks.eligible.mockResolvedValueOnce({ tags: [] }).mockRejectedValueOnce(new Error('url_not_configured'))
    expect(await startCapture(run)).toBeNull()
    expect(mocks.claim).toHaveBeenCalledWith(id, id, 'capture_claimed')
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(id, id, { status: 'reconciliation', error_code: 'target_changed_before_capture' })
  })
  it('does not start a paid request after settings were disabled', async () => {
    mocks.claim.mockRejectedValue(new Error('execution_disabled'))
    expect(await startCapture(run)).toBeNull(); expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(id, id, expect.objectContaining({ capture_cost_usd: 0, interpretation_cost_usd: 0, error_code: 'execution_disabled' }))
  })
  it('does not interpret after entitlement was revoked', async () => {
    mocks.input.mockResolvedValue({ signal: { id: 's', interpretation_status: 'pending' }, evidence: [], context: '' })
    mocks.claim.mockRejectedValue(new Error('execution_disabled'))
    await understand(run); expect(mocks.interpret).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(id, id, expect.objectContaining({ interpretation_cost_usd: 0 }))
  })
  it('fails closed and preserves unknown cost when the configured target cannot be read', async () => {
    mocks.input.mockResolvedValue({ signal: { id: 's', interpretation_status: 'pending' }, evidence: [], context: '' })
    mocks.eligible.mockRejectedValue(new Error('target_read_failed'))
    await understand(run)
    expect(mocks.interpret).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(id, id, { status: 'reconciliation', error_code: 'target_unavailable_interpretation_state_unknown' })
    expect(mocks.update).not.toHaveBeenCalledWith(id, id, expect.objectContaining({ interpretation_cost_usd: 0 }))
  })
  it('does not trust a stale pre-claim run when target lookup fails on retry', async () => {
    const staleRun = { ...run, interpretation_claimed: false, interpretation_cost_usd: null }
    mocks.input.mockResolvedValue({ signal: { id: 's', interpretation_status: 'pending' }, evidence: [], context: '' })
    mocks.eligible.mockRejectedValue(new Error('target_read_failed'))
    await understand(staleRun)
    expect(mocks.interpret).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(id, id, { status: 'reconciliation', error_code: 'target_unavailable_interpretation_state_unknown' })
    expect(mocks.update).not.toHaveBeenCalledWith(id, id, expect.objectContaining({ interpretation_cost_usd: 0 }))
  })
  it('does not retry a transport-ambiguous paid start', async () => {
    mocks.start.mockRejectedValue(new Error('timeout'))
    expect(await startCapture(run)).toBeNull(); expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.settle).not.toHaveBeenCalled()
  })
  it('does not refund a run whose receipt could not be persisted', async () => {
    mocks.update.mockRejectedValueOnce(new Error('db failure')).mockResolvedValue(undefined)
    expect(await startCapture(run)).toBeNull(); expect(mocks.settle).not.toHaveBeenCalled()
  })
  it('does not create snapshots from rejected captures', async () => {
    mocks.get.mockResolvedValue({ status: 'failed', run: { status: 'SUCCEEDED', defaultDatasetId: 'd', usageTotalUsd: 0.03 } })
    expect(await collectCapture(run, 'p')).toBe('failed'); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('keeps unknown capture cost null, never zero', async () => {
    mocks.get.mockResolvedValue({ status: 'failed', run: { status: 'FAILED' } })
    await collectCapture(run, 'p')
    expect(mocks.update).toHaveBeenCalledWith(id, id, { capture_cost_usd: null })
  })
  it('stores a valid snapshot before interpreting, using a stable content hash', async () => {
    mocks.get.mockResolvedValue({ status: 'complete', run: { status: 'SUCCEEDED', usageTotalUsd: 0.01 }, page: { url: run.url, title: 'Prices', text: 'Valid page content '.repeat(20) } })
    expect(await collectCapture(run, 'p')).toBe('captured')
    expect(mocks.rpc).toHaveBeenCalledWith('web_intelligence_record_business_snapshot', expect.objectContaining({
      p_id: id, p_client_id: id, p_raw_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_projection_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_projection_version: 'business-content-v1+actor-1.2.3',
    }))
  })
  it('uses the travel profile projection and versions its baseline separately', async () => {
    const travelRun = { ...run, url: 'https://example.com/new-tours/' }
    mocks.eligible.mockResolvedValue({ tags: ['industry:travel'] })
    mocks.get.mockResolvedValue({ status: 'complete', run: { status: 'SUCCEEDED', usageTotalUsd: 0.01 }, page: {
      url: travelRun.url, title: 'New tours', text: 'New tours available for New Zealand travellers\n* EARLY BIRD SALE\nDisplay Map\nTour A\n10 days from $5,000pp\nIncludes international flights\nAuckland - A - B - Auckland\nView Tour',
    } })
    expect(await collectCapture(travelRun, 'p')).toBe('captured')
    expect(mocks.rpc).toHaveBeenCalledWith('web_intelligence_record_business_snapshot', expect.objectContaining({
      p_projection: expect.stringContaining('Tour: Tour A'),
      p_projection_version: 'business-content-v1+me-travel-v2+actor-1.2.3',
      p_page_role: 'product_listing',
    }))
  })
  it('settles a paid capture whose business projection is too weak', async () => {
    mocks.get.mockResolvedValue({ status: 'complete', run: { status: 'SUCCEEDED', usageTotalUsd: 0.01 }, page: { url: run.url, title: 'Assets', text: '![image](https://example.com/a.jpg) '.repeat(20) } })
    expect(await collectCapture(run, 'p')).toBe('failed')
    expect(mocks.update).toHaveBeenCalledWith(id, id, expect.objectContaining({ error_code: 'capture_content_limit', interpretation_cost_usd: 0 }))
    expect(mocks.settle).toHaveBeenCalledWith(id, id)
  })
  it('settles a paid capture if its configured target was removed while running', async () => {
    mocks.get.mockResolvedValue({ status: 'complete', run: { status: 'SUCCEEDED', usageTotalUsd: 0.01 }, page: { url: run.url, title: 'Tour', text: 'Valid tour content '.repeat(20) } })
    mocks.eligible.mockRejectedValue(new Error('url_not_configured'))
    expect(await collectCapture(run, 'p')).toBe('failed')
    expect(mocks.update).toHaveBeenCalledWith(id, id, expect.objectContaining({ error_code: 'target_changed_after_capture' }))
    expect(mocks.settle).toHaveBeenCalledWith(id, id)
  })
  it('baseline and unchanged captures incur no interpretation call', async () => {
    mocks.input.mockResolvedValue({ signal: null, evidence: [], context: '' }); await understand(run)
    expect(mocks.interpret).not.toHaveBeenCalled(); expect(mocks.update).toHaveBeenCalledWith(id, id, { interpretation_cost_usd: 0 })
  })
  it('passes travel comparison rules to the model only for a travel target', async () => {
    const pendingSignal = { id: 's', interpretation_status: 'pending', before_evidence_id: 'before', after_evidence_id: 'after' }
    const productScope = { status: 'inferred', market_ids: ['china'], labels: ['中国'], basis: ['china tours'], source: '主关键词', rule_version: 'travel-market-v1' }
    const evidence = [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: $1' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Wonders of China | Price: $2' },
    ]
    mocks.input.mockResolvedValue({ signal: pendingSignal, evidence, context: '', productScope, productScopeAvailable: true })
    mocks.eligible.mockResolvedValue({ tags: ['industry:travel'] })
    mocks.interpret.mockResolvedValue({ text: '{}', cost_usd: 0.01, stop_reason: 'end_turn' })
    mocks.validate.mockReturnValue({ classification: 'ignore', recommended_action: '无需采取行动。' })
    await understand(run)
    expect(mocks.interpret).toHaveBeenCalledWith(pendingSignal, evidence, '', expect.stringContaining('exact Tour name'), productScope)
  })
  it('overrides a model action when the changed Tour is outside the client product scope', () => {
    const scope = { status: 'inferred' as const, market_ids: ['china'], labels: ['中国'], basis: ['china tours'], source: '主关键词' as const, rule_version: 'travel-market-v1' as const }
    const s = { before_evidence_id: 'before', after_evidence_id: 'after' }
    const ev = [
      { id: 'before', source_url: run.url, excerpt: 'Tour: Japan Explorer | Price: $1' },
      { id: 'after', source_url: run.url, excerpt: 'Tour: Japan Explorer | Price: $2' },
    ]
    const guarded = guardInterpretationByProductScope({ classification: 'threat' as const, recommended_action: '降价。' }, s as never, ev as never, scope, true)
    expect(guarded).toEqual({ classification: 'ignore', recommended_action: '无需采取行动。' })
  })
  it('overrides a model action when product-scope evidence could not be read', () => {
    const scope = { status: 'inferred' as const, market_ids: ['china'], labels: ['中国'], basis: ['china tours'], source: '主关键词' as const, rule_version: 'travel-market-v1' as const }
    const guarded = guardInterpretationByProductScope({ classification: 'opportunity' as const, recommended_action: '投放。' }, { before_evidence_id: 'before', after_evidence_id: 'after' } as never, [] as never, scope, false)
    expect(guarded.classification).toBe('ignore')
    expect(guarded.recommended_action).toBe('无需采取行动。')
  })
  it('an uncertain interpretation attempt does not create another paid call', async () => {
    mocks.input.mockResolvedValue({ signal: { id: 's', interpretation_status: 'pending' }, evidence: [], context: '' }); mocks.claim.mockResolvedValue(false)
    await understand(run); expect(mocks.interpret).not.toHaveBeenCalled()
  })
  it('retains a known LLM charge when JSON validation fails', async () => {
    mocks.input.mockResolvedValue({ signal: { id: 's', interpretation_status: 'pending' }, evidence: [], context: '' })
    mocks.interpret.mockResolvedValue({ text: 'invalid', cost_usd: 0.02 }); mocks.validate.mockImplementation(() => { throw new Error('invalid') })
    await understand(run)
    expect(mocks.update).toHaveBeenCalledWith(id, id, { interpretation_cost_usd: 0.02 })
    expect(mocks.signal).toHaveBeenCalledWith('s', id, { interpretation_status: 'failed' })
  })
  it.each(['truncated', 'invalid_result', 'persist_failed'] as const)('identifies %s without refunding or retrying the paid model call', async reason => {
    mocks.input.mockResolvedValue({ signal: { id: 's', interpretation_status: 'pending' }, evidence: [], context: '' })
    mocks.interpret.mockResolvedValue({ text: '{}', cost_usd: 0.02, stop_reason: reason === 'truncated' ? 'max_tokens' : 'end_turn' })
    mocks.validate.mockReturnValue({ classification: 'ignore', recommended_action: 'No action recommended.' })
    if (reason === 'invalid_result') mocks.validate.mockImplementation(() => { throw new Error('private response text') })
    if (reason === 'persist_failed') mocks.signal.mockRejectedValueOnce(new Error('db failure'))
    await understand(run)
    expect(mocks.interpret).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith(id, id, { interpretation_cost_usd: 0.02 })
    expect(mocks.update).toHaveBeenCalledWith(id, id, { status: 'failed', error_code: `interpretation_${reason}` })
    expect(mocks.settle).not.toHaveBeenCalled()
  })
  it('normalises layout whitespace without removing content changes', () => {
    expect(normaliseContent(' price   $5\r\n\n offer ')).toBe('price $5\noffer')
    expect(normaliseContent('price $6')).not.toBe(normaliseContent('price $5'))
  })
})
