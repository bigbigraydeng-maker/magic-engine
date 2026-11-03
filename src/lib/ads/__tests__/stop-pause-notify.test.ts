/**
 * 暂停之后的信和待办。不发真邮件，不写库。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildStopNotice, deliverStopNotice, formatMinor, noticeHasUrgency, readStopAlertRecipient, type StopPauseFacts } from '../stop-pause-notify'
import { pauseNoticeItems, type PauseNoticeRow } from '@/lib/pm-todo/ads-service-pause-items'
import { LANE_OF_KIND } from '@/lib/pm-todo/five-kinds'
import { runStopPauseNotify, type StopPauseNotifyDeps } from '@/lib/inngest/functions/ads-service-pause-notify'

const FACTS: StopPauseFacts = {
  campaign_name: '表单系列',
  campaign_id: '333333333333',
  ad_account_id: 'act_444444444444',
  spend_today_cents: 2500,
  spend_lifetime_cents: null,
  currency: 'NZD',
  fault_code: 'over_daily_cap+crm_leads_missing',
  fault_what: '当天花费 NZD 25.00，超过日预算 NZD 10.00 的 2 倍',
  as_of: '2026-10-26T20:00:00.000Z',
}

const ROOT = path.resolve(__dirname, '../../../..')

describe('信的内容', () => {
  it('写明系列、账户、当天和累计花费、原因、数据时间，没有催促字眼', () => {
    expect(formatMinor(null, 'NZD')).toBe('没读到')
    expect(formatMinor(2500, 'NZD')).toBe('NZD 25.00')
    const notice = buildStopNotice(FACTS)
    expect(notice.subject).toContain('表单系列')
    expect(notice.text).toContain('广告系列已经暂停。')
    expect(notice.text).toContain('编号 333333333333')
    expect(notice.text).toContain('账户：act_444444444444')
    expect(notice.text).toContain('当天花费：NZD 25.00')
    expect(notice.text).toContain('累计花费：没读到')
    expect(notice.text).toContain('超过当天花费上限')
    expect(notice.text).toContain('线索没有进到客户资料')
    expect(notice.text).toContain(FACTS.fault_what)
    expect(notice.text).toContain('新西兰时间')
    expect(notice.text).toContain('要恢复投放，由负责人在 Magic Engine 里点确认卡。')
    expect(noticeHasUrgency(notice.subject + notice.text)).toBe(false)
  })

  it('收件人没配就不是发送失败；发送失败和没配收件人分开', async () => {
    expect(readStopAlertRecipient({})).toBeNull()
    expect(readStopAlertRecipient({ ME_STOP_ALERT_EMAIL: '  ' })).toBeNull()
    expect(readStopAlertRecipient({ ME_MAIL_TO: 'someone@example.test' })).toBeNull()
    const unconfigured = await deliverStopNotice({ facts: FACTS, recipient: null, mail: { send: async () => ({ ok: true }) } })
    expect(unconfigured).toBe('recipient_unconfigured')
    const failed = await deliverStopNotice({ facts: FACTS, recipient: 'ops@example.test', mail: null })
    expect(failed).toBe('send_failed')
    const sent = await deliverStopNotice({
      facts: FACTS,
      recipient: 'ops@example.test',
      mail: { send: async () => ({ ok: true }) },
    })
    expect(sent).toBe('sent')
  })

  it('新写的通知代码里不写死收件地址', () => {
    const files = [
      'src/lib/ads/stop-pause-notify.ts',
      'src/lib/pm-todo/ads-service-pause-items.ts',
      'src/lib/inngest/functions/ads-service-pause-notify.ts',
    ]
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8')
      expect(text, file).not.toContain('hello@')
      expect(text, file).not.toContain('magicengine.cloud')
    }
  })
})

describe('今日待办', () => {
  const now = new Date('2026-10-27T02:00:00.000Z')
  const row = (over: { executed_at?: string; payload?: Record<string, unknown> } = {}): PauseNoticeRow => ({
    client_id: 'c1',
    executed_at: over.executed_at ?? '2026-10-27T01:00:00.000Z',
    payload: {
      status: 'paused',
      campaign_id: '333333333333',
      campaign_name: '表单系列',
      ad_account_id: 'act_444444444444',
      spend_today_cents: 2500,
      spend_lifetime_cents: 9000,
      currency: 'NZD',
      fault_what: '超过当天花费上限',
      as_of: '2026-10-26T20:00:00.000Z',
      ...over.payload,
    },
  })

  it('只留最近暂停成功的那一条，恢复是要人决定的', () => {
    expect(LANE_OF_KIND.ads_service_pause_notice).toBe('decide')
    const items = pauseNoticeItems([
      row(),
      row({ executed_at: '2026-10-20T00:00:00.000Z' }),
      row({ payload: { status: 'meta_failed', campaign_id: '333333333334' } }),
      row({ executed_at: '2026-10-27T01:30:00.000Z', payload: { campaign_id: '333333333333', campaign_name: '较新的一条' } }),
    ], now, () => '客户甲', true)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ads_service_pause_notice')
    expect(items[0].what).toContain('较新的一条')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/ads-health')
    expect(items[0].how).toContain('点确认卡')
    expect(items[0].how).not.toContain('邮件没有发出去')
    expect(noticeHasUrgency(items[0].what + items[0].how)).toBe(false)
  })

  it('没配收件人或发送失败时说邮件没出去，但不把地址写进待办', () => {
    const missing = pauseNoticeItems([row()], now, () => '客户甲', false)
    expect(missing[0].how).toContain('邮件没有发出去：未配置收件人')
    expect(missing[0].how).not.toContain('@')
    const failed = pauseNoticeItems([row({ payload: { email_status: 'send_failed' } })], now, () => '客户甲', true)
    expect(failed[0].how).toContain('邮件没有发出去')
    expect(failed[0].how).not.toContain('未配置收件人')
    const sent = pauseNoticeItems([row({ payload: { email_status: 'sent' } })], now, () => '客户甲', false)
    expect(sent[0].how).not.toContain('邮件没有发出去')
  })
})

describe('通知只发一次', () => {
  it('已经记成发过的，不再发', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    const save = vi.fn(async () => {})
    const deps: StopPauseNotifyDeps = {
      load: async () => ({ id: 'action-1', payload: { ...FACTS, status: 'paused', email_status: 'sent' } }),
      saveStatus: save,
      recipient: () => 'ops@example.test',
      mail: { send },
    }
    const out = await runStopPauseNotify({ client_id: 'c1', action_id: 'action-1' }, deps)
    expect(out).toEqual({ email_status: 'sent' })
    expect(send).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
