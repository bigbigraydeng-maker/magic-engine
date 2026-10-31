import { describe, expect, it } from 'vitest'
import { doubtCheck, doubtConfirm, doubtExplanation, type Outcome } from '../stuck-rows'

const STAGE_ID = 'mixed:conversion-stage'

function purchase(over: Partial<Outcome> = {}): Outcome {
  return {
    id: 'mixed',
    outcome_kind: 'purchase',
    order_ref: '84191',
    amount_minor: 2350000,
    currency: 'NZD',
    occurred_at: '2026-10-28T00:00:00.000Z',
    review_status: 'approved',
    reject_reason: null,
    redacted_at: null,
    source_kind: 'crm_sheet_sync',
    source_ref: 'row-9',
    created_at: '2026-10-28T00:00:00.000Z',
    contact_id: null,
    customer_first: null,
    me_conversion_writebacks: [
      {
        id: 'primary',
        status: 'confirmed',
        last_error: null,
        last_error_code: null,
        next_attempt_at: null,
        event_id: 'mixed',
      },
      {
        id: 'stage',
        status: 'in_doubt',
        last_error: '断了',
        last_error_code: null,
        next_attempt_at: null,
        event_id: STAGE_ID,
        stage_name: 'balance_received',
      },
    ],
    ...over,
  }
}

describe('doubt check names the send that is still unconfirmed', () => {
  it('names the stage event, not the confirmed purchase, and shows the stage and send id', () => {
    const row = purchase()
    expect(doubtCheck(row)).toEqual({
      which: 'stage',
      stageName: 'balance_received',
      eventId: STAGE_ID,
    })
    const text = doubtExplanation(row)
    expect(text).toContain('阶段事件')
    expect(text).toContain('不是原来的这笔成交')
    expect(text).toContain('balance_received')
    expect(text).toContain(STAGE_ID)
    const confirm = doubtConfirm(row, 'confirmed')
    expect(confirm).toContain('后面那个阶段事件')
    expect(confirm).toContain('阶段：balance_received')
    expect(confirm).toContain(`发送编号：${STAGE_ID}`)
    expect(confirm).toContain('不要把它当成这一条')
  })

  it('names the original deal when that send is the one still unconfirmed', () => {
    const row = purchase({
      me_conversion_writebacks: [
        {
          id: 'primary',
          status: 'in_doubt',
          last_error: '断了',
          last_error_code: null,
          next_attempt_at: null,
          event_id: 'mixed',
        },
      ],
    })
    expect(doubtCheck(row)?.which).toBe('deal')
    expect(doubtExplanation(row)).toContain('原来的这笔成交')
    expect(doubtExplanation(row)).toContain('发送编号「mixed」')
    expect(doubtExplanation(row)).not.toContain('阶段是')
    expect(doubtConfirm(row, 'confirmed')).toContain('原来的这笔成交')
    expect(doubtConfirm(row, 'confirmed')).toContain('发送编号：mixed')
  })

  it('reads a qualified-lead stage name from the recorded ref', () => {
    const row = purchase({
      outcome_kind: 'lead',
      source_ref: 'crm_qualified:1687504185706630:quoted',
      me_conversion_writebacks: [
        {
          id: 'lead-send',
          status: 'in_doubt',
          last_error: '断了',
          last_error_code: null,
          next_attempt_at: null,
          event_id: 'lead-send',
        },
      ],
    })
    expect(doubtCheck(row)).toMatchObject({ which: 'stage', stageName: 'quoted', eventId: 'lead-send' })
  })
})
