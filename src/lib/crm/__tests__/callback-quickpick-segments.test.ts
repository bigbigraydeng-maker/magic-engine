/**
 * 「约回电」快捷项存下来的触点，在分段和今天名单里到底怎么走。
 *
 * 钉三件事（PM 2026-11-01 要的核对）：
 *   1. 到点（callback_at <= now）→ 分到 callback_due（热、优先级 2）。
 *   2. 没到点 → 不是 callback_due。
 *   3. 没到点时他在不在「今天要联系」里 —— 这条是**核对现状**，不是改行为：
 *      记笔当天他留在原位（已处理）；第二天早上、没到点，他在「先放着」；到点回到最上面。
 *      （lib/crm/next-step 里那段「未到期的人照旧每天出现」的注释已经跟现状对不上。）
 */

import { describe, expect, it } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import { buildContactModel, type ContactRowLike, type TouchpointRowLike } from '../contact-model'
import { contactsTouchedToday, localDayStartMs } from '../day-list'
import { segmentContact } from '../segments'

const TZ = 'Pacific/Auckland'
/** 新西兰 11/01 14:00（夏令时 UTC+13，周日）。 */
const NOW = new Date('2026-11-01T01:00:00.000Z')
/** 约的是明天（周一）上午 10 点 = UTC 周日 21:00。 */
const DUE_AT = '2026-11-01T21:00:00.000Z'
const NOTE_AT = '2026-11-01T00:30:00.000Z'

const contact = (id: string): ContactRowLike => ({
  id,
  display_name: id,
  primary_phone: '+64211230001',
  primary_email: `${id.toLowerCase()}@example.com`,
  do_not_contact: false,
  snooze_until: null,
  stage: null,
})

const enquiry = (id: string): TouchpointRowLike => ({
  contact_id: id,
  channel: 'web_form',
  direction: 'inbound',
  occurred_at: '2026-10-29T02:00:00.000Z',
  source: 'web_form',
  raw: null,
  metadata: null,
})

/** 销售在抽屉里点了「明天上午 10 点」存下的那笔（outcome=callback_set + callback_at）。 */
const bookedNote = (id: string): TouchpointRowLike => ({
  contact_id: id,
  channel: 'phone',
  direction: 'outbound',
  occurred_at: NOTE_AT,
  source: 'me_manual',
  raw: '客人在忙，约明天上午再聊',
  metadata: { outcome: 'callback_set', callback_at: DUE_AT, logged_by: 'info@ctstours.co.nz' },
})

const segAt = (id: string, tps: TouchpointRowLike[], at: Date) =>
  segmentContact(buildContactModel(contact(id), tps, new Map()), at)

describe('约回电：到点才算 callback_due', () => {
  it('约定时间已到（差一分钟）→ callback_due，热，优先级 2', () => {
    const seg = segAt('Amy', [enquiry('Amy'), bookedNote('Amy')], new Date('2026-11-01T21:01:00.000Z'))
    expect(seg.segment).toBe('callback_due')
    expect(seg.temperature).toBe('hot')
    expect(seg.priority).toBe(2)
  })

  it('约定时间还没到（差一分钟）→ 不是 callback_due', () => {
    const seg = segAt('Amy', [enquiry('Amy'), bookedNote('Amy')], new Date('2026-11-01T20:59:00.000Z'))
    expect(seg.segment).not.toBe('callback_due')
  })
})

describe('约回电：没到点时他在不在「今天要联系」（核对现状）', () => {
  const viewAt = (id: string, tps: TouchpointRowLike[], at: Date) => {
    const { sections } = buildPriorityView<{ id: string; segment: string; handled: boolean | undefined }>(
      {
        contacts: [contact(id)],
        touchpoints: tps,
        stageMeta: new Map(),
        now: at,
        open: { hot: true, cold: true },
        dayStartMs: localDayStartMs(at, TZ),
        touchedToday: contactsTouchedToday(tps, at, TZ),
      },
      (row, ranked) => ({ id: row.id, segment: ranked.seg.segment, handled: ranked.handled }),
    )
    return {
      hot: sections.find((s) => s.key === 'hot')?.items ?? [],
      cold: sections.find((s) => s.key === 'cold')?.items ?? [],
    }
  }

  it('记笔当天：他留在原位、标成已处理（员工刚处理完，不让他消失）', () => {
    const { hot, cold } = viewAt('Amy', [enquiry('Amy'), bookedNote('Amy')], NOW)
    expect(hot.map((r) => r.id)).toEqual(['Amy'])
    expect(hot[0].handled).toBe(true)
    expect(cold).toEqual([])
  })

  it('第二天早上、约定时间之前：不在「今天要联系」里（挪进先放着）', () => {
    // 新西兰周一 08:00，约的是 10:00。
    const { hot, cold } = viewAt('Amy', [enquiry('Amy'), bookedNote('Amy')], new Date('2026-11-01T19:00:00.000Z'))
    expect(hot).toEqual([])
    expect(cold.map((r) => r.id)).toEqual(['Amy'])
  })

  it('约定时间一到：回到「今天要联系」，分段 callback_due', () => {
    const { hot } = viewAt('Amy', [enquiry('Amy'), bookedNote('Amy')], new Date('2026-11-01T21:01:00.000Z'))
    expect(hot.map((r) => [r.id, r.segment])).toEqual([['Amy', 'callback_due']])
  })
})
