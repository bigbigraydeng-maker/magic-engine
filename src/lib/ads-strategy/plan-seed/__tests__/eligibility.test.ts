import { describe, it, expect } from 'vitest'
import { judgeEligibility, type EligibilityInput } from '../eligibility'

function ok(over: Partial<EligibilityInput> = {}): EligibilityInput {
  const base: EligibilityInput = {
    play: 'lead_form_harvest',
    pageId: '123',
    pageToken: { state: 'ok', value: true },
    scopes: {
      state: 'ok',
      value: ['leads_retrieval', 'pages_manage_ads', 'pages_show_list'],
    },
    forms: { state: 'ok', value: [{ id: 'f1', active: true }] },
    accountStatus: 1,
    currencyKnown: true,
    promotePages: { state: 'ok', value: ['123'] },
    tokenSource: 'client_page',
    accountId: 'act_1',
  }
  return { ...base, ...over }
}

describe('judgeEligibility', () => {
  it('marks a fully good input as eligible with no why_empty and records token source basis', () => {
    const result = judgeEligibility(ok())
    expect(result.eligible).toBe(true)
    expect(result.why_empty).toBeUndefined()
    expect(result.basis.some((b) => b.value === '令牌来源=client_page')).toBe(true)
  })

  it('rejects when pageId is null or empty', () => {
    const nullResult = judgeEligibility(ok({ pageId: null }))
    expect(nullResult.eligible).toBe(false)
    expect(nullResult.why_empty).toContain('客户没配主页')

    const emptyResult = judgeEligibility(ok({ pageId: '' }))
    expect(emptyResult.eligible).toBe(false)
    expect(emptyResult.why_empty).toContain('客户没配主页')
  })

  it('rejects when pageToken is empty or failed', () => {
    const emptyResult = judgeEligibility(ok({ pageToken: { state: 'empty' } }))
    expect(emptyResult.eligible).toBe(false)
    expect(emptyResult.why_empty).toContain('拿不到这个主页的访问令牌')

    const failedResult = judgeEligibility(
      ok({ pageToken: { state: 'failed', reason: 'boom' } }),
    )
    expect(failedResult.eligible).toBe(false)
    expect(failedResult.why_empty).toContain('拿不到这个主页的访问令牌')
    expect(failedResult.why_empty).toContain('boom')
  })

  it('rejects lead_form_harvest when scopes are failed, empty, or missing required scopes', () => {
    const failed = judgeEligibility(ok({ scopes: { state: 'failed', reason: 'x' } }))
    expect(failed.eligible).toBe(false)
    expect(failed.why_empty).toContain('读不到令牌权限')

    const empty = judgeEligibility(ok({ scopes: { state: 'empty' } }))
    expect(empty.eligible).toBe(false)
    expect(empty.why_empty).toContain('读到 0 项')

    const missingLeads = judgeEligibility(
      ok({ scopes: { state: 'ok', value: ['pages_manage_ads'] } }),
    )
    expect(missingLeads.eligible).toBe(false)
    expect(missingLeads.why_empty).toContain('令牌缺少权限')
    expect(missingLeads.why_empty).toContain('leads_retrieval')

    const missingPages = judgeEligibility(
      ok({ scopes: { state: 'ok', value: ['leads_retrieval'] } }),
    )
    expect(missingPages.eligible).toBe(false)
    expect(missingPages.why_empty).toContain('令牌缺少权限')
    expect(missingPages.why_empty).toContain('pages_manage_ads')
  })

  it('handles forms empty, failed, all inactive, and one active', () => {
    const empty = judgeEligibility(ok({ forms: { state: 'empty' } }))
    expect(empty.eligible).toBe(false)
    expect(empty.why_empty).toContain('也可能是这个令牌看不到')
    expect(empty.why_empty).not.toContain('没有表单')

    const failed = judgeEligibility(ok({ forms: { state: 'failed', reason: 'x' } }))
    expect(failed.eligible).toBe(false)
    expect(failed.why_empty).toContain('读不到表单列表')

    const inactive = judgeEligibility(
      ok({ forms: { state: 'ok', value: [{ id: 'f1', active: false }] } }),
    )
    expect(inactive.eligible).toBe(false)
    expect(inactive.why_empty).toContain('读到的表单都已停用')

    const oneActive = judgeEligibility(
      ok({
        forms: {
          state: 'ok',
          value: [
            { id: 'f1', active: false },
            { id: 'f2', active: true },
          ],
        },
      }),
    )
    expect(oneActive.eligible).toBe(true)
  })

  it('checks account status', () => {
    const notOne = judgeEligibility(ok({ accountStatus: 2 }))
    expect(notOne.eligible).toBe(false)
    expect(notOne.why_empty).toContain('账户状态码是 2')

    const nullStatus = judgeEligibility(ok({ accountStatus: null }))
    expect(nullStatus.eligible).toBe(false)
    expect(nullStatus.why_empty).toContain('读不到账户状态')

    const good = judgeEligibility(ok({ accountStatus: 1 }))
    expect(good.eligible).toBe(true)
  })

  it('rejects when currency is unknown', () => {
    const result = judgeEligibility(ok({ currencyKnown: false }))
    expect(result.eligible).toBe(false)
    expect(result.why_empty).toContain('读不到账户币种')
  })

  it('skips scope and form checks for non-lead plays but still checks pageId', () => {
    const badScopesAndForms = {
      scopes: { state: 'failed', reason: 'x' } as const,
      forms: { state: 'empty' } as const,
    }

    const thruplay = judgeEligibility(
      ok({ play: 'thruplay_pool_build', ...badScopesAndForms }),
    )
    expect(thruplay.eligible).toBe(true)

    const messenger = judgeEligibility(
      ok({ play: 'messenger_direct', ...badScopesAndForms }),
    )
    expect(messenger.eligible).toBe(true)

    const missingScopes = judgeEligibility(
      ok({
        play: 'thruplay_pool_build',
        scopes: { state: 'ok', value: [] },
        forms: { state: 'empty' },
      }),
    )
    expect(missingScopes.eligible).toBe(true)

    const noPage = judgeEligibility(
      ok({ play: 'thruplay_pool_build', pageId: null }),
    )
    expect(noPage.eligible).toBe(false)
    expect(noPage.why_empty).toContain('客户没配主页')
  })

  it('never lets promotePages affect eligibility, only basis and notes', () => {
    const cases: EligibilityInput['promotePages'][] = [
      { state: 'ok', value: [] },
      { state: 'ok', value: ['999'] },
      { state: 'ok', value: ['123'] },
      { state: 'empty' },
      { state: 'failed', reason: 'Meta 拒绝' },
    ]

    for (const promotePages of cases) {
      const eligibleResult = judgeEligibility(ok({ promotePages }))
      expect(eligibleResult.eligible).toBe(true)
      expect(eligibleResult.why_empty).toBeUndefined()

      const ineligibleResult = judgeEligibility(
        ok({ promotePages, accountStatus: 2 }),
      )
      expect(ineligibleResult.eligible).toBe(false)
      expect(ineligibleResult.why_empty).toBeDefined()
      expect(ineligibleResult.why_empty).not.toContain('可推广主页')

      expect(
        eligibleResult.basis.some((b) => b.label === '可推广主页（仅供参考）'),
      ).toBe(true)
      expect(eligibleResult.notes).toHaveLength(1)
      const note = eligibleResult.notes[0]
      expect(note).toContain('client_page')
      expect(note).toContain('不影响是否合格')
    }

    const contains = judgeEligibility(
      ok({ promotePages: { state: 'ok', value: ['123'] } }),
    )
    expect(contains.notes[0]).toContain('含该主页')

    const notContains = judgeEligibility(
      ok({ promotePages: { state: 'ok', value: ['999'] } }),
    )
    expect(notContains.notes[0]).toContain('不含该主页')

    const failed = judgeEligibility(
      ok({ promotePages: { state: 'failed', reason: 'Meta 拒绝' } }),
    )
    expect(failed.notes[0]).toContain('Meta 拒绝')
  })

  it('joins multiple reasons with the full-width semicolon', () => {
    const result = judgeEligibility(ok({ pageId: null, accountStatus: 2 }))
    expect(result.eligible).toBe(false)
    expect(result.why_empty).toBeDefined()
    expect(result.why_empty).toContain('客户没配主页')
    expect(result.why_empty).toContain('账户状态码是 2')
    expect(result.why_empty).toContain('；')
  })

  it('does not mutate the input', () => {
    const input = ok({
      pageId: null,
      accountStatus: 2,
      promotePages: { state: 'failed', reason: 'Meta 拒绝' },
    })
    const before = JSON.parse(JSON.stringify(input)) as EligibilityInput
    judgeEligibility(input)
    const after = JSON.parse(JSON.stringify(input)) as EligibilityInput
    expect(after).toEqual(before)
  })
})
