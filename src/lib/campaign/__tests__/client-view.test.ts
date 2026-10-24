import { describe, expect, it } from 'vitest'
import { campaignPatchForViewer, campaignViewer, presentCampaign, presentCampaigns } from '../client-view'

const row = {
  id: 'c1',
  client_id: 'client',
  status: 'active',
  title: '春季团',
  description: 'PM 2026-10-06 指令：停放中，刻意的。竞品调研：对方在投低价团。',
  parsed_content: '抓下来的竞品页全文',
  semrush_keywords: [{ keyword: 'cheap tour', volume: 100 }],
  vi_input_notes: '内部画面备注',
  vi_reference_note: '不要给客户看的参考',
  secret_column: '以后新加的内部列',
  valid_from: '2026-10-01',
  offer: '早鸟价',
}

describe('推广活动客户视图', () => {
  it('both / dashboard 成员是客户，管理员名单是内部', () => {
    expect(campaignViewer('client-viewer')).toBe('client')
    expect(campaignViewer('admin')).toBe('internal')
  })

  it('客户拿不到内部备注、竞品调研和未点名的列', () => {
    const view = presentCampaign(row, 'client') as Record<string, unknown>
    expect(view.title).toBe('春季团')
    expect(view.offer).toBe('早鸟价')
    expect(view.description).toBeUndefined()
    expect(view.parsed_content).toBeUndefined()
    expect(view.semrush_keywords).toBeUndefined()
    expect(view.vi_input_notes).toBeUndefined()
    expect(view.vi_reference_note).toBeUndefined()
    expect(view.secret_column).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('PM 2026-10-06')
    expect(JSON.stringify(view)).not.toContain('竞品')
  })

  it('内部账号仍拿到整行', () => {
    expect(presentCampaign(row, 'internal')).toBe(row)
    expect(presentCampaigns([row], 'internal')).toEqual([row])
  })

  it('客户保存时丢掉 description，不能把内部备注改成空', () => {
    const patch = campaignPatchForViewer(
      { title: '新名字', description: null, parsed_content: 'x', status: 'archived' },
      'client',
    )
    expect(patch).toEqual({ title: '新名字' })
  })

  it('内部账号保存仍可改 description', () => {
    const patch = campaignPatchForViewer(
      { title: '新名字', description: 'PM 备注', status: 'archived', id: 'c1' },
      'internal',
    )
    expect(patch).toEqual({ title: '新名字', description: 'PM 备注' })
  })
})
