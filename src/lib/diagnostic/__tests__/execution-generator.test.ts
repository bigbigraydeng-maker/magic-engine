/**
 * TDD RED: execution-generator tests
 *
 * Tests generateExecutionItems(supabase, prescriptionId, clientId):
 * 1. me_auto action → execution_item with me_deeplink in steps_json
 * 2. third_party action → steps_json has steps[] and verification
 * 3. 3-phase prescription → items stored with correct phase + sort_order
 * 4. Same prescription_id → idempotent (no duplicate generation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrescriptionContent, ExecutionItem } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { generateExecutionItems } from '../execution-generator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRESCRIPTION_ID = 'presc-001'
const CLIENT_ID       = 'client-xyz'

const CONTENT_3_PHASES: PrescriptionContent = {
  summary: 'Test prescription',
  phases: [
    {
      phase_number: 1,
      name: '即时修复',
      duration_weeks: 4,
      actions: [
        {
          id:          'a-1',
          title:       '批量生成 meta title',
          description: '使用 SEO 内容引擎自动生成',
          dimension:   'seo',
          fix_type:    'me_auto',
          phase:       1,
          effort:      'low',
          impact:      'high',
          finding_ids: ['f-1'],
        },
      ],
    },
    {
      phase_number: 2,
      name: '结构改善',
      duration_weeks: 6,
      actions: [
        {
          id:          'a-2',
          title:       '优化 Google Business Profile',
          description: '人工更新 Google Business Profile 信息',
          dimension:   'reputation',
          fix_type:    'fde_manual',
          phase:       2,
          effort:      'medium',
          impact:      'medium',
          finding_ids: [],
        },
      ],
    },
    {
      phase_number: 3,
      name: '长期增长',
      duration_weeks: 8,
      actions: [
        {
          id:          'a-3',
          title:       '申请行业媒体反链',
          description: '联系行业媒体争取外链资源',
          dimension:   'seo',
          fix_type:    'third_party',
          phase:       3,
          effort:      'high',
          impact:      'high',
          finding_ids: [],
        },
      ],
    },
  ],
  kpi_targets: [],
  budget_allocation: [],
}

/** Build realistic steps_json for a given fix_type */
function makeStepsJson(fixType: string, title: string): Record<string, unknown> {
  if (fixType === 'me_auto') {
    return { type: 'me_auto', deeplink: '/dashboard/clients/{clientId}', steps: [`自动执行：${title}`], owner_tool: 'SEO 内容引擎' }
  }
  if (fixType === 'fde_manual') {
    return { type: 'fde_manual', steps: ['第 1 步：登录平台', '第 2 步：执行操作', '第 3 步：保存截图'], owner_tool: '客户网站后台' }
  }
  return { type: 'third_party', steps: ['第 1 步：访问平台', '第 2 步：操作', '第 3 步：确认'], verification: `验证 "${title}" 已生效`, owner_tool: '相关第三方平台' }
}

/** Build a minimal supabase mock for the execution generator.
 *
 *  Models the `execution_items` TABLE rather than the generator's call order:
 *  a `head: true` select answers the count probe, a plain select answers the
 *  read-back. The previous version keyed off "first from() call vs second",
 *  which silently stopped matching the generator once its idempotency check
 *  moved from "is there any row?" to "are there as many rows as expected?".
 */
function buildSupabaseMock(opts: {
  existingItems?: unknown[]
  prescriptionContent?: PrescriptionContent | null
  insertedItems?: unknown[]
}) {
  const {
    existingItems = [],
    prescriptionContent = CONTENT_3_PHASES,
    insertedItems,
  } = opts

  // Build realistic inserted items that include steps_json
  const defaultInserted = prescriptionContent
    ? prescriptionContent.phases.flatMap((ph, phIdx) =>
        ph.actions.map((a, aIdx) => ({
          id:              `ei-${phIdx}-${aIdx}`,
          prescription_id: PRESCRIPTION_ID,
          client_id:       CLIENT_ID,
          finding_id:      a.finding_ids[0] ?? null,
          dimension:       a.dimension,
          phase:           ph.phase_number,
          title:           a.title,
          description:     a.description,
          fix_type:        a.fix_type,
          status:          'pending',
          steps_json:      makeStepsJson(a.fix_type, a.title),
          assigned_to:     null,
          due_date:        null,
          completed_at:    null,
          sort_order:      (ph.phase_number - 1) * 100 + aIdx,
          created_at:      '2026-05-13T00:00:00Z',
          updated_at:      '2026-05-13T00:00:00Z',
        }))
      )
    : []

  const finalInserted = insertedItems ?? defaultInserted

  // Shared across every from('execution_items') so a test can prove that no
  // write happened, not merely that from() was called.
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: finalInserted, error: null }),
  })

  return {
    /** Test handle — not part of the SupabaseClient surface. */
    _insert: insert,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'execution_items') {
        return {
          insert,
          select: vi.fn().mockImplementation((_cols: string, selectOpts?: { head?: boolean }) => {
            // `.select('id', { count: 'exact', head: true })` — the count probe
            if (selectOpts?.head) {
              return {
                eq: vi.fn().mockResolvedValue({
                  count: existingItems.length,
                  data:  null,
                  error: null,
                }),
              }
            }
            // `.select('*').eq(...).order(...)` — read back what's already there
            return {
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: existingItems, error: null }),
              }),
            }
          }),
        }
      }

      if (table === 'prescriptions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data:  prescriptionContent ? { content: prescriptionContent, client_id: CLIENT_ID } : null,
            error: prescriptionContent ? null : { message: 'Not found' },
          }),
        }
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateExecutionItems()', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // =========================================================================
  // 1. me_auto action → execution_item with me_deeplink in steps_json
  // =========================================================================
  it('me_auto action produces an execution item with a deeplink in steps_json', async () => {
    const supabase = buildSupabaseMock({})
    const items = await generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)

    const meAutoItem = items.find(i => i.fix_type === 'me_auto')
    expect(meAutoItem).toBeDefined()
    expect(meAutoItem?.steps_json).toBeTruthy()
    const stepsJson = meAutoItem?.steps_json as Record<string, unknown>
    expect(stepsJson.type).toBe('me_auto')
    expect(typeof stepsJson.deeplink).toBe('string')
    expect((stepsJson.deeplink as string).length).toBeGreaterThan(0)
  })

  // =========================================================================
  // 2. third_party action → steps_json has steps[] and verification
  // =========================================================================
  it('third_party action produces steps_json with steps array and verification', async () => {
    const supabase = buildSupabaseMock({})
    const items = await generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)

    const thirdPartyItem = items.find(i => i.fix_type === 'third_party')
    expect(thirdPartyItem).toBeDefined()
    const stepsJson = thirdPartyItem?.steps_json as Record<string, unknown>
    expect(stepsJson.type).toBe('third_party')
    expect(Array.isArray(stepsJson.steps)).toBe(true)
    expect((stepsJson.steps as unknown[]).length).toBeGreaterThan(0)
    expect(typeof stepsJson.verification).toBe('string')
  })

  // =========================================================================
  // 3. 3 phases → items stored with correct phase + sort_order
  // =========================================================================
  it('creates items for all 3 phases with correct phase and sort_order', async () => {
    const supabase = buildSupabaseMock({})
    const items = await generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)

    expect(items.length).toBe(3)   // 1 action per phase × 3 phases

    const phases = items.map(i => i.phase)
    expect(phases).toContain(1)
    expect(phases).toContain(2)
    expect(phases).toContain(3)

    // Phase 1 sort_order should be in 0–99
    const p1 = items.find(i => i.phase === 1)
    expect(p1?.sort_order).toBeLessThan(100)

    // Phase 2 sort_order should be in 100–199
    const p2 = items.find(i => i.phase === 2)
    expect(p2?.sort_order).toBeGreaterThanOrEqual(100)
    expect(p2?.sort_order).toBeLessThan(200)

    // Phase 3 sort_order should be ≥ 200
    const p3 = items.find(i => i.phase === 3)
    expect(p3?.sort_order).toBeGreaterThanOrEqual(200)
  })

  // =========================================================================
  // 4. Idempotent: same prescription_id → no duplicate generation
  // =========================================================================
  it('returns existing items without re-inserting when items already exist', async () => {
    // The prescription has 3 actions, so a complete set is 3 rows.
    const alreadyExisting = [
      { id: 'ei-existing-1', phase: 1, sort_order: 0 },
      { id: 'ei-existing-2', phase: 2, sort_order: 100 },
      { id: 'ei-existing-3', phase: 3, sort_order: 200 },
    ]
    const supabase = buildSupabaseMock({ existingItems: alreadyExisting })

    const items = await generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)

    // Returns what was already there…
    expect(items.map(i => i.id)).toEqual(['ei-existing-1', 'ei-existing-2', 'ei-existing-3'])
    // …and writes nothing.
    expect(supabase._insert).not.toHaveBeenCalled()
  })

  // Regression for 78791451: a stray partial set must NOT count as "already
  // generated", otherwise the remaining actions are lost with no error.
  it('re-generates when only some items exist (partial set is not done)', async () => {
    const supabase = buildSupabaseMock({ existingItems: [{ id: 'ei-stray', phase: 1, sort_order: 0 }] })

    const items = await generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)

    expect(supabase._insert).toHaveBeenCalledOnce()
    expect(items.length).toBe(3)
  })

  // =========================================================================
  // 5. fde_manual action → steps_json has steps array
  // =========================================================================
  it('fde_manual action produces steps_json with step-by-step instructions', async () => {
    const supabase = buildSupabaseMock({})
    const items = await generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)

    const fdeItem = items.find(i => i.fix_type === 'fde_manual')
    expect(fdeItem).toBeDefined()
    const stepsJson = fdeItem?.steps_json as Record<string, unknown>
    expect(stepsJson.type).toBe('fde_manual')
    expect(Array.isArray(stepsJson.steps)).toBe(true)
    expect((stepsJson.steps as unknown[]).length).toBeGreaterThan(0)
  })

  // =========================================================================
  // 6. Prescription not found → throws error
  // =========================================================================
  it('throws an error when prescription is not found', async () => {
    const supabase = buildSupabaseMock({ prescriptionContent: null })

    await expect(
      generateExecutionItems(supabase as never, PRESCRIPTION_ID, CLIENT_ID)
    ).rejects.toThrow()
  })
})
