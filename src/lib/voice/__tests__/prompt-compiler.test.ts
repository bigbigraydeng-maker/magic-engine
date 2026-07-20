import { describe, it, expect } from 'vitest'
import { compileSystemPrompt, compileGreeting } from '../prompt-compiler'
import type { AgentRow, TenantRow } from '../store/types'
import type { BusinessBrain } from '../brain'

const tenant: TenantRow = {
  id: 't1', client_id: null, slug: 'demo', name: 'Demo Co', status: 'active',
  default_timezone: 'Pacific/Auckland', default_language: 'en-NZ', openai_vector_store_id: null, settings: {},
}

function agentFixture(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1', tenant_id: 't1', name: 'Mia', role: 'sales', status: 'active', model: 'gpt-realtime-2.1-mini',
    voice: 'marin', reasoning_effort: 'low', primary_language: 'en-NZ', supported_languages: ['en-NZ'],
    greeting: 'Hi there.', system_instructions: '', ai_disclosure_required: true, business_hours: {},
    human_transfer_uri: 'tel:+6421000000', transfer_targets: {}, enabled_tools: ['search_knowledge_base', 'transfer_to_human'],
    settings: {}, ...overrides,
  }
}

const brain: BusinessBrain = {
  brandName: 'Demo Co', coreProposition: 'We do X.', primaryAudience: 'SMBs', painPoints: [], products: null,
  tone: 'Warm', avoidWords: ['cheap'], contentPillars: null, redlinePhrases: ['guaranteed win'],
  country: 'NZ', city: null, source: 'tenant_settings',
}

describe('compileGreeting (板桥 #1 AI disclosure)', () => {
  it('appends AI disclosure when missing and required', () => {
    const g = compileGreeting(agentFixture({ greeting: 'Hi there.' }), brain)
    expect(g).toMatch(/AI/)
  })
  it('does not double-add when greeting already discloses', () => {
    const g = compileGreeting(agentFixture({ greeting: 'Hi, this is the AI assistant.' }), brain)
    expect(g).toBe('Hi, this is the AI assistant.')
  })
  it('respects disclosure not required', () => {
    const g = compileGreeting(agentFixture({ greeting: 'Hello', ai_disclosure_required: false }), brain)
    expect(g).toBe('Hello')
  })
})

describe('compileSystemPrompt hard constraints', () => {
  const prompt = compileSystemPrompt({ agent: agentFixture(), tenant, brain, enabledTools: ['search_knowledge_base', 'transfer_to_human'], direction: 'inbound' })

  it('states AI identity (板桥 #1)', () => {
    expect(prompt).toMatch(/You are an AI assistant, not a human/i)
  })
  it('bakes in the three-forbidden rule (板桥 #2)', () => {
    expect(prompt).toMatch(/NEVER INVENT OR GUESS/i)
    expect(prompt).toMatch(/prices/i)
    expect(prompt).toMatch(/availability/i)
  })
  it('includes brand redlines (板桥 #4)', () => {
    expect(prompt).toMatch(/guaranteed win/)
    expect(prompt).toMatch(/cheap/)
  })
  it('references knowledge tool when enabled', () => {
    expect(prompt).toMatch(/search_knowledge_base/)
  })
  it('adapts language block to market', () => {
    const au = compileSystemPrompt({ agent: agentFixture(), tenant, brain: { ...brain, country: 'AU' }, enabledTools: [], direction: 'inbound' })
    expect(au).toMatch(/Australian English/)
  })
})
