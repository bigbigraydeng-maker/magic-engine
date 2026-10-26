/**
 * `buildContactModel` 是全部 CRM 读路径喂给 `segmentContact` 的形状。
 * 它漏一个字段，两个页面就会对同一个人给不同分段——事故形态与 2026-09-24
 * ROADMAP M2.7f 一致。这里钉住形状的关键位。
 */
import { describe, expect, it } from 'vitest'
import {
  buildContactModel,
  buildTouchpointLike,
  type ContactRowLike,
  type TouchpointRowLike,
  type StageMetaLike,
} from '../contact-model'

const NOW = '2026-09-26T00:00:00Z'
const HOUR_AGO = '2026-09-25T23:00:00Z'

function row(over: Partial<ContactRowLike> = {}): ContactRowLike {
  return {
    id: 'c1',
    display_name: 'Sue Masson',
    primary_phone: '+64211234567',
    primary_email: 'sue@example.com',
    do_not_contact: false,
    snooze_until: null,
    stage: null,
    ...over,
  }
}

function tp(over: Partial<TouchpointRowLike> = {}): TouchpointRowLike {
  return {
    contact_id: 'c1',
    channel: 'phone',
    direction: 'outbound',
    occurred_at: HOUR_AGO,
    source: 'me_manual',
    raw: null,
    metadata: null,
    ...over,
  }
}

const stages = new Map<string, StageMetaLike>([
  ['contacted', { label: '已联系', suppressed: false }],
  ['paid_full', { label: '已付全款', suppressed: true }],
])

describe('buildContactModel', () => {
  it('装配基础字段：id / displayName / hasPhone / hasEmail / snoozeUntil / stageLabel', () => {
    const m = buildContactModel(row({ snooze_until: NOW, stage: 'contacted' }), [], stages)
    expect(m.id).toBe('c1')
    expect(m.displayName).toBe('Sue Masson')
    expect(m.hasPhone).toBe(true)
    expect(m.hasEmail).toBe(true)
    expect(m.hasMessenger).toBe(false)
    expect(m.snoozeUntil).toBe(NOW)
    expect(m.stageLabel).toBe('已联系')
    expect(m.stageSuppressed).toBe(false)
  })

  it('阶段是抑制阶段 → stageSuppressed=true（成交后不进今天名单）', () => {
    const m = buildContactModel(row({ stage: 'paid_full' }), [], stages)
    expect(m.stageSuppressed).toBe(true)
  })

  it('未配置的 stage_key → 保守当不抑制、label 走 null（不塞原值，展示层自己 fallback）', () => {
    const m = buildContactModel(row({ stage: 'ghost_stage' }), [], stages)
    expect(m.stageSuppressed).toBe(false)
    expect(m.stageLabel).toBeNull()
  })

  it('别的客人的触点不会混进来（同 supabase 一次 in-batch 查回来的常见形态）', () => {
    const m = buildContactModel(row(), [tp({ contact_id: 'other', channel: 'messenger' })], stages)
    expect(m.touchpoints).toHaveLength(0)
    expect(m.hasMessenger).toBe(false)
  })

  it('有 messenger 触点 → hasMessenger=true', () => {
    const m = buildContactModel(row(), [tp({ channel: 'messenger', direction: 'inbound' })], stages)
    expect(m.hasMessenger).toBe(true)
  })

  it('metadata.do_not_contact=true → doNotContact=true（即便 contacts 列没写）', () => {
    const m = buildContactModel(
      row({ do_not_contact: false }),
      [tp({ metadata: { do_not_contact: true } })],
      stages,
    )
    expect(m.doNotContact).toBe(true)
  })

  it('metadata.outcome=dnc_cleared 覆盖 contacts.do_not_contact=true（人纠正过这条判错了；判据字符串在 lib/crm/dnc.DNC_CLEARED_OUTCOME）', () => {
    const m = buildContactModel(
      row({ do_not_contact: true }),
      [tp({ metadata: { outcome: 'dnc_cleared' } })],
      stages,
    )
    expect(m.doNotContact).toBe(false)
  })

  it('metadata.action=snooze / unsnooze 原样透传，别的值一律 null（避免新按钮偷偷影响判断）', () => {
    expect(buildTouchpointLike(tp({ metadata: { action: 'snooze' } })).action).toBe('snooze')
    expect(buildTouchpointLike(tp({ metadata: { action: 'unsnooze' } })).action).toBe('unsnooze')
    expect(buildTouchpointLike(tp({ metadata: { action: 'ping' } })).action).toBeNull()
  })

  it('群发邮件（source=mailchimp）→ automated=true；员工手打（me_manual）→ false', () => {
    expect(buildTouchpointLike(tp({ channel: 'email', direction: 'outbound', source: 'mailchimp' })).automated).toBe(true)
    expect(buildTouchpointLike(tp({ source: 'me_manual' })).automated).toBe(false)
  })

  it('电话系统记录的外呼没人接 → unansweredCall=true；接通 / 入站 / 手打笔记 / 别的渠道都不是', () => {
    const unanswered = { metadata: { answered: false } }
    expect(buildTouchpointLike(tp(unanswered)).unansweredCall).toBe(true)
    expect(buildTouchpointLike(tp({ metadata: { answered: true } })).unansweredCall).toBe(false)
    expect(buildTouchpointLike(tp({ ...unanswered, direction: 'inbound' })).unansweredCall).toBe(false)
    expect(buildTouchpointLike(tp({ metadata: null })).unansweredCall).toBe(false)
    expect(buildTouchpointLike(tp({ ...unanswered, channel: 'email' })).unansweredCall).toBe(false)
  })

  it('邮件打开 / 链接点开变成 engagement，不当作出站消息', () => {
    expect(buildTouchpointLike(tp({ metadata: { email_opened: true } })).engagement).toBe('open')
    expect(buildTouchpointLike(tp({ metadata: { email_clicked: true } })).engagement).toBe('click')
    expect(buildTouchpointLike(tp({ metadata: null })).engagement).toBeNull()
  })

  it('outcome 是存量老值 → 走 reclassifyStoredOutcome，不是原样透传', () => {
    // reclassifyStoredOutcome 对空 metadata + 空 raw 的默认值应保持稳定为 null；改动这条断言要同时看 note-parser 那侧
    expect(buildTouchpointLike(tp()).outcome).toBeNull()
  })

  it('touchpoints 输出顺序与输入一致（调用方决定顺序，本函数不排序）', () => {
    const a = tp({ occurred_at: '2026-09-20T00:00:00Z' })
    const b = tp({ occurred_at: '2026-09-24T00:00:00Z' })
    const m = buildContactModel(row(), [a, b], stages)
    expect(m.touchpoints.map((t) => t.occurredAt)).toEqual(['2026-09-20T00:00:00Z', '2026-09-24T00:00:00Z'])
  })
})
