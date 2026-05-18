/**
 * Report Composer tests — P8.10.S4.1
 *
 * Verifies generateReport(supabase, runId, clientId, opts) produces:
 *   - markdown    : full markdown report with sections in the expected order
 *   - html        : printable, self-contained HTML document
 *   - evidence    : separate JSON artifact (findings + narrative metadata)
 *
 * Section omission rules (carried over from S3.6):
 *   - narrative bucket empty  → that bucket's section is omitted
 *   - no prescription in DB and no intake provided → prescription section omitted
 *   - missing dimension score → "无数据" placeholder used (does not crash)
 *
 * Prescription source preference:
 *   - read prescriptions table by (run_id, client_id) first
 *   - fall back to generatePrescription only when intake is supplied
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  DiagnosticRun,
  DiagnosticFinding,
  PrescriptionContent,
  PrescriptionIntake,
} from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Hoisted mocks (run before any module import below)
// ---------------------------------------------------------------------------

const { mockLoadNarratives, mockGeneratePrescription } = vi.hoisted(() => ({
  mockLoadNarratives: vi.fn(),
  mockGeneratePrescription: vi.fn(),
}))

vi.mock('../synthesis/persistence', async () => {
  const actual = await vi.importActual<typeof import('../synthesis/persistence')>(
    '../synthesis/persistence',
  )
  return { ...actual, loadNarrativesForRun: mockLoadNarratives }
})

vi.mock('../prescription-generator', () => ({
  generatePrescription: mockGeneratePrescription,
}))

import { generateReport } from '../report-generator'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID    = 'run-r1'
const CLIENT_ID = 'client-c1'

const MOCK_RUN: DiagnosticRun = {
  id: RUN_ID,
  client_id: CLIENT_ID,
  triggered_by: 'user',
  status: 'completed',
  dimensions_requested: ['seo', 'ai_visibility', 'social', 'reputation', 'competitor', 'ads'],
  dimensions_skipped: [],
  overall_score: 62,
  dimension_scores: {
    seo: 55,
    ai_visibility: 40,
    ads: 70,
    social: 65,
    reputation: 80,
    competitor: 50,
  },
  findings_count: 3,
  critical_count: 1,
  high_count: 2,
  started_at: '2026-05-18T10:00:00Z',
  completed_at: '2026-05-18T10:05:00Z',
  error_message: null,
  created_at: '2026-05-18T10:00:00Z',
}

const MOCK_CLIENT = { id: CLIENT_ID, name: 'CTS Tours', domain: 'ctstours.co.nz' }

const MOCK_FINDINGS: DiagnosticFinding[] = [
  {
    id: 'f-1',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    dimension: 'seo',
    finding_type: 'missing_meta_title',
    severity: 'critical',
    title: '缺少 meta title',
    description: '23 pages missing meta title',
    evidence: { count: 23 },
    recommendation: 'Add meta titles to all pages',
    fix_type: 'me_auto',
    priority_score: 90,
    created_at: '2026-05-18T10:01:00Z',
  },
  {
    id: 'f-2',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    dimension: 'ai_visibility',
    finding_type: 'brand_not_mentioned',
    severity: 'high',
    title: 'AI 未提及品牌',
    description: 'Brand absent from AI responses',
    evidence: null,
    recommendation: 'Deploy GEO directives',
    fix_type: 'me_auto',
    priority_score: 80,
    created_at: '2026-05-18T10:01:00Z',
  },
]

const MOCK_NARRATIVES = [
  {
    id: 'n-1',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    kind: 'market_context',
    dimension: null,
    narrative_md: '## NZ tourism market is rebounding\n\nKey trend: **inbound traffic up 18%**.',
    metadata: { citations: [{ url: 'https://stats.govt.nz/abc' }] },
    model: 'claude-sonnet-4-6',
    cost_usd: 0.12,
    generated_at: '2026-05-18T10:02:00Z',
    created_at: '2026-05-18T10:02:00Z',
  },
  {
    id: 'n-2',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    kind: 'dimension_narrative',
    dimension: 'seo',
    narrative_md: 'SEO foundation is thin — meta tags and schema are largely missing.',
    metadata: null,
    model: 'claude-sonnet-4-6',
    cost_usd: 0.05,
    generated_at: '2026-05-18T10:02:00Z',
    created_at: '2026-05-18T10:02:00Z',
  },
  {
    id: 'n-3',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    kind: 'competitor_market_structure',
    dimension: 'competitor',
    narrative_md: 'Two dominant operators control ~60% of organic share.',
    metadata: null,
    model: 'claude-sonnet-4-6',
    cost_usd: 0.08,
    generated_at: '2026-05-18T10:02:00Z',
    created_at: '2026-05-18T10:02:00Z',
  },
  {
    id: 'n-4',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    kind: 'competitor_benchmarking_path',
    dimension: 'competitor',
    narrative_md: 'Step 1: close the meta-tag gap. Step 2: build out comparison pages.',
    metadata: null,
    model: 'claude-sonnet-4-6',
    cost_usd: 0.08,
    generated_at: '2026-05-18T10:02:00Z',
    created_at: '2026-05-18T10:02:00Z',
  },
  {
    id: 'n-5',
    run_id: RUN_ID,
    client_id: CLIENT_ID,
    kind: 'score_explanation',
    dimension: 'seo',
    narrative_md: 'Score 55 reflects missing on-page fundamentals despite decent content depth.',
    metadata: { score: 55 },
    model: 'claude-sonnet-4-6',
    cost_usd: 0.03,
    generated_at: '2026-05-18T10:02:00Z',
    created_at: '2026-05-18T10:02:00Z',
  },
]

const MOCK_PRESCRIPTION: PrescriptionContent = {
  summary: '三阶段处方：先补 SEO 基础，再部署 GEO 指令，最后建立长期反链护城河。',
  phases: [
    {
      phase_number: 1,
      name: '第一阶段：止血',
      duration_weeks: 4,
      actions: [
        {
          id: 'a-1',
          title: '批量补全 meta title',
          description: '为 23 个页面生成 keyword-rich meta title',
          dimension: 'seo',
          fix_type: 'me_auto',
          phase: 1,
          effort: 'low',
          impact: 'high',
          finding_ids: ['f-1'],
        },
      ],
    },
    {
      phase_number: 2,
      name: '第二阶段：结构建设',
      duration_weeks: 6,
      actions: [
        {
          id: 'a-2',
          title: '部署 GEO 指令',
          description: '面向 NZ travelers 上线品牌 GEO 指令',
          dimension: 'ai_visibility',
          fix_type: 'me_auto',
          phase: 2,
          effort: 'medium',
          impact: 'high',
          finding_ids: ['f-2'],
        },
      ],
    },
    {
      phase_number: 3,
      name: '第三阶段：长期护城河',
      duration_weeks: 8,
      actions: [],
    },
  ],
  kpi_targets: [
    {
      metric: '月有机搜索流量',
      current_value: 1200,
      target_value: 2000,
      unit: '次/月',
      dimension: 'seo',
    },
  ],
  budget_allocation: [
    { dimension: 'seo', amount_aud: 1500, percentage: 50 },
    { dimension: 'ai_visibility', amount_aud: 1000, percentage: 33 },
    { dimension: 'social', amount_aud: 500, percentage: 17 },
  ],
}

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------

interface BuildOpts {
  run?: DiagnosticRun | null
  client?: typeof MOCK_CLIENT | null
  findings?: DiagnosticFinding[]
  prescriptionRow?: { content: PrescriptionContent; generated_at: string } | null
}

function buildSupabase(opts: BuildOpts = {}) {
  const {
    run = MOCK_RUN,
    client = MOCK_CLIENT,
    findings = MOCK_FINDINGS,
    prescriptionRow = { content: MOCK_PRESCRIPTION, generated_at: '2026-05-18T10:03:00Z' },
  } = opts

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'diagnostic_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: run,
            error: run ? null : { message: 'not found' },
          }),
        }
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: client, error: null }),
        }
      }
      if (table === 'diagnostic_findings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: findings, error: null }),
        }
      }
      if (table === 'prescriptions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: prescriptionRow, error: null }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateReport — P8.10.S4.1', () => {
  beforeEach(() => {
    mockLoadNarratives.mockReset()
    mockGeneratePrescription.mockReset()
    mockLoadNarratives.mockResolvedValue(MOCK_NARRATIVES)
  })

  it('produces markdown with all major sections in canonical order', async () => {
    const supabase = buildSupabase()
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)

    const sections = [
      '# 诊断报告',
      '## 摘要',
      '## 基线快照',
      '## 维度详情',
      '## 竞品分析',
      '## 市场上下文',
      '## 处方建议',
    ]
    let lastIdx = -1
    for (const s of sections) {
      const idx = markdown.indexOf(s)
      expect(idx, `section missing: ${s}`).toBeGreaterThan(-1)
      expect(idx, `section out of order: ${s}`).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  it('includes client metadata, overall score, and dimension scores', async () => {
    const supabase = buildSupabase()
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).toContain('CTS Tours')
    expect(markdown).toContain('ctstours.co.nz')
    expect(markdown).toContain('62')              // overall score
    expect(markdown).toContain('SEO')              // dimension label
    expect(markdown).toContain('AI 可见度')
  })

  it('injects all four narrative buckets', async () => {
    const supabase = buildSupabase()
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).toContain('NZ tourism market is rebounding')
    expect(markdown).toContain('SEO foundation is thin')
    expect(markdown).toContain('Two dominant operators')
    expect(markdown).toContain('Step 1: close the meta-tag gap')
    expect(markdown).toContain('Score 55 reflects')
  })

  it('renders prescription summary, phases, KPI targets, and budget', async () => {
    const supabase = buildSupabase()
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).toContain('三阶段处方')
    expect(markdown).toContain('第一阶段：止血')
    expect(markdown).toContain('批量补全 meta title')
    expect(markdown).toContain('月有机搜索流量')
    expect(markdown).toContain('1500')   // budget amount
  })

  it('omits narrative sections when bucket is empty', async () => {
    mockLoadNarratives.mockResolvedValue([])  // no narratives at all
    const supabase = buildSupabase()
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).not.toContain('## 竞品分析')
    expect(markdown).not.toContain('## 市场上下文')
  })

  it('falls back to generatePrescription when DB has no prescription and intake is supplied', async () => {
    const supabase = buildSupabase({ prescriptionRow: null })
    mockGeneratePrescription.mockResolvedValue({
      prescriptionId: 'presc-new',
      content: MOCK_PRESCRIPTION,
    })
    const intake: PrescriptionIntake = {
      business_goal: 'grow',
      timeline_urgency: 'short_term',
      monthly_budget_aud: 3000,
      priority_dimensions: ['seo'],
      notes: null,
    }
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID, { intake })
    expect(mockGeneratePrescription).toHaveBeenCalledWith(supabase, RUN_ID, CLIENT_ID, intake)
    expect(markdown).toContain('三阶段处方')
  })

  it('omits prescription section when DB empty and no intake provided', async () => {
    const supabase = buildSupabase({ prescriptionRow: null })
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(mockGeneratePrescription).not.toHaveBeenCalled()
    expect(markdown).not.toContain('## 处方建议')
  })

  it('produces a self-contained HTML document with print CSS', async () => {
    const supabase = buildSupabase()
    const { html } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toMatch(/<html[\s>]/)
    expect(html).toContain('<body')
    expect(html).toContain('</body>')
    expect(html).toContain('</html>')
    expect(html).toContain('@media print')
    expect(html).toContain('@page')
    expect(html).toContain('CTS Tours')
    expect(html).toContain('<h1')
    expect(html).toContain('<h2')
  })

  it('does not embed evidence appendix in markdown or html', async () => {
    const supabase = buildSupabase()
    const { markdown, html } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).not.toContain('## 证据附录')
    expect(html).not.toContain('证据附录')
  })

  it('emits a separate evidence.json artifact with findings and narrative metadata', async () => {
    const supabase = buildSupabase()
    const { evidence } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(evidence.filename).toMatch(/evidence.*\.json$/)
    const parsed = JSON.parse(evidence.json) as {
      run_id: string
      client_id: string
      findings: DiagnosticFinding[]
      narratives: Array<{ id: string; kind: string; dimension: string | null }>
    }
    expect(parsed.run_id).toBe(RUN_ID)
    expect(parsed.client_id).toBe(CLIENT_ID)
    expect(parsed.findings).toHaveLength(MOCK_FINDINGS.length)
    expect(parsed.findings[0].id).toBe('f-1')
    expect(parsed.narratives.length).toBe(MOCK_NARRATIVES.length)
    expect(parsed.narratives[0]).toHaveProperty('kind')
  })

  // ── P8.10.S5.2 — citation injection ──────────────────────────────────────

  it('injects <sup class="cite"> in HTML when narrative has evidence_refs', async () => {
    const narrativesWithRefs = MOCK_NARRATIVES.map(n =>
      n.kind === 'dimension_narrative' && n.dimension === 'seo'
        ? { ...n, evidence_refs: ['https://ctstours.co.nz', 'https://semrush.com/x'] }
        : { ...n, evidence_refs: [] },
    )
    mockLoadNarratives.mockResolvedValue(narrativesWithRefs)
    const supabase = buildSupabase()
    const { html } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(html).toContain('<sup class="cite"')
    expect(html).toContain('data-idx="1"')
    expect(html).toContain('[1]')
  })

  it('embeds __cite_data__ JSON script when evidence_refs exist', async () => {
    const narrativesWithRefs = MOCK_NARRATIVES.map(n =>
      n.kind === 'score_explanation' && n.dimension === 'seo'
        ? { ...n, evidence_refs: ['https://ctstours.co.nz'] }
        : { ...n, evidence_refs: [] },
    )
    mockLoadNarratives.mockResolvedValue(narrativesWithRefs)
    const supabase = buildSupabase()
    const { html } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(html).toContain('__cite_data__')
    const match = /<script id="__cite_data__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
    expect(match).not.toBeNull()
    const data = JSON.parse(match![1]) as Record<string, string[]>
    expect(data['1']).toContain('https://ctstours.co.nz')
  })

  it('strips [[cite:...]] markers from markdown artifact', async () => {
    const narrativesWithRefs = MOCK_NARRATIVES.map(n =>
      n.kind === 'dimension_narrative' && n.dimension === 'seo'
        ? { ...n, evidence_refs: ['https://example.com'] }
        : { ...n, evidence_refs: [] },
    )
    mockLoadNarratives.mockResolvedValue(narrativesWithRefs)
    const supabase = buildSupabase()
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).not.toContain('[[cite:')
  })

  it('produces no <sup> and no __cite_data__ when all evidence_refs are empty', async () => {
    const narrativesNoRefs = MOCK_NARRATIVES.map(n => ({ ...n, evidence_refs: [] }))
    mockLoadNarratives.mockResolvedValue(narrativesNoRefs)
    const supabase = buildSupabase()
    const { html } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(html).not.toContain('<sup class="cite"')
    expect(html).not.toContain('__cite_data__')
  })

  it('throws when diagnostic run is missing', async () => {
    const supabase = buildSupabase({ run: null })
    await expect(
      generateReport(supabase as never, RUN_ID, CLIENT_ID),
    ).rejects.toThrow(/run/i)
  })

  it('handles missing dimension scores with a placeholder, does not crash', async () => {
    const supabase = buildSupabase({
      run: { ...MOCK_RUN, dimension_scores: { seo: 55 } },
    })
    const { markdown } = await generateReport(supabase as never, RUN_ID, CLIENT_ID)
    expect(markdown).toContain('无数据')
  })
})
