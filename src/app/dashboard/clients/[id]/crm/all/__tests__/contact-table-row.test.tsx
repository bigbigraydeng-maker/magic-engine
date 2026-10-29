import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContactTableRow, nameForDisplay } from '../_components/ContactTableRow'
import type { ContactRow } from '../_components/contact-table-types'

function makeRow(over: Partial<ContactRow> = {}): ContactRow {
  return {
    contactId: 'c1',
    name: 'Jane Doe',
    firstSeenAt: '2026-10-01T00:00:00Z',
    lastTouchAt: '2026-10-10T00:00:00Z',
    phone: '+64211111111',
    email: null,
    hasMessenger: false,
    stage: null,
    stageLabel: null,
    pinnedAt: null,
    important: { note: null, dueAt: null },
    segment: 's',
    segmentLabel: 'S',
    temperature: 'cold',
    intent: null,
    assignedTo: null,
    custom: {},
    nextAction: {
      list: 'hot',
      verb: 'call',
      verbLabel: '打给他',
      line: '打给他 —— 进线了，还没人联系',
      reason: '进线了，还没人联系',
      aiSuggestion: null,
      intentBoost: false,
    },
    ...over,
  }
}

function renderRow(row: ContactRow, grouped = false) {
  return render(
    <table>
      <tbody>
        <ContactTableRow
          row={row}
          active={false}
          grouped={grouped}
          columns={[{ key: 'tour', label: '感兴趣的团' }]}
          onToggle={vi.fn()}
          onTogglePin={vi.fn()}
        />
      </tbody>
    </table>,
  )
}

describe('nameForDisplay 与后端同一套判据', () => {
  it('后端兜底词「未留姓名」也算没留名；带 @ 的昵称（kay@home）是名字，不算', () => {
    expect(nameForDisplay({ name: '未留姓名', phone: null, email: null, hasMessenger: true })).toEqual({ text: '未留名', missing: true, sub: '仅 FB 私信' })
    expect(nameForDisplay({ name: 'kay@home', phone: null, email: null, hasMessenger: false })).toEqual({ text: 'kay@home', missing: false, sub: null })
  })
})

describe('nameForDisplay', () => {
  it('把 "WhatsApp Business" 当成没留名，副标题用电话', () => {
    const r = nameForDisplay({
      name: 'WhatsApp Business',
      phone: '+16465894168',
      email: null,
      hasMessenger: false,
    })
    expect(r).toEqual({ text: '未留名', missing: true, sub: '+16465894168' })
  })

  it('名字是邮箱时也算没留名，副标题用邮箱', () => {
    const r = nameForDisplay({
      name: 'traceyray@gmx.com',
      phone: null,
      email: 'traceyray@gmx.com',
      hasMessenger: false,
    })
    expect(r.missing).toBe(true)
    expect(r.sub).toBe('traceyray@gmx.com')
  })

  it('空名字且没有任何联系方式时，副标题是「没留联系方式」', () => {
    const r = nameForDisplay({
      name: '',
      phone: null,
      email: null,
      hasMessenger: false,
    })
    expect(r.sub).toBe('没留联系方式')
  })

  it('正常名字不算没留名，也没有副标题', () => {
    const r = nameForDisplay({
      name: 'Jane Doe',
      phone: '+64211111111',
      email: null,
      hasMessenger: false,
    })
    expect(r.missing).toBe(false)
    expect(r.sub).toBeNull()
  })
})

describe('ContactTableRow', () => {
  it('名字是 "WhatsApp Business" 时显示「未留名」，不显示原名', () => {
    renderRow(makeRow({ name: 'WhatsApp Business', phone: '+16465894168' }))
    expect(screen.getByText('未留名')).toBeTruthy()
    expect(screen.queryByText('WhatsApp Business')).toBeNull()
  })

  it('没有触点、没有自定义列时显示破折号，不显示「还没联系过」之类的文案', () => {
    renderRow(makeRow({ lastTouchAt: null, custom: {} }))
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('还没联系过')).toBeNull()
    expect(screen.queryByText('还没聊到')).toBeNull()
  })

  it('grouped 模式下长原因被截断，title 是完整原因，动词标签照常显示', () => {
    const reason = '进线了还没人联系他上次说想报团但一直没定下来我们得赶紧打过去问清楚。'.repeat(2)
    expect(reason.length).toBeGreaterThanOrEqual(60)
    renderRow(
      makeRow({
        nextAction: {
          list: 'hot',
          verb: 'call',
          verbLabel: '打给他',
          line: `打给他 —— ${reason}`,
          reason,
          aiSuggestion: null,
          intentBoost: false,
        },
      }),
      true,
    )
    const reasonEl = screen.getByTitle(reason)
    expect(reasonEl.className).toContain('truncate')
    expect(screen.getByText('打给他')).toBeTruthy()
  })
})

describe('🔥 回头标签（PM 2026-10-27：之前咨询过、我们联系过、今天又填了表）', () => {
  const returning = {
    firstEnquiryAt: '2026-06-15T07:55:00.000Z',
    latestFormAt: '2026-10-26T23:47:00.000Z',
    ourLastContactAt: '2026-10-24T01:11:00.000Z',
    ourContacts: 3,
    earlierForms: 1,
  }

  it('回头客 → 名字旁出现「🔥 回头」，悬停说清为什么', () => {
    renderRow(makeRow({ returning, reason: '回头了：6月15日就咨询过，我们联系过 3 次，今天又填了表，意向很强' }))
    const tag = screen.getByTestId('returning-tag')
    expect(tag.textContent).toContain('回头')
    expect(tag.getAttribute('title')).toContain('回头了')
  })

  it('🔴 不是回头客 → 没有这个标签（别满屏飘红）', () => {
    renderRow(makeRow({ returning: null }))
    expect(screen.queryByTestId('returning-tag')).toBeNull()
    renderRow(makeRow())
    expect(screen.queryByTestId('returning-tag')).toBeNull()
  })

  it('标签摆在渠道小标签前面（这一行最该先看到的东西）', () => {
    renderRow(makeRow({ returning, sources: ['fb_form'] }))
    const html = document.body.innerHTML
    expect(html.indexOf('returning-tag')).toBeGreaterThan(-1)
    expect(html.indexOf('returning-tag')).toBeLessThan(html.indexOf('FB 表单'))
  })
})

describe('「今天先联系」每行只留三样：名字 / 一句话原因 / 一个渠道', () => {
  it('分段视图：客人 + 进线 + 最近联系 + 该做什么 + 联系渠道；不画联系方式、自定义列、来源小标签', () => {
    renderRow(makeRow({ suggestedChannel: 'phone', sources: ['fb_form'], custom: { tour: 'Best of China' } }), true)
    expect(screen.getByText('Jane Doe')).toBeTruthy()
    expect(screen.getByText('进线了，还没人联系')).toBeTruthy()
    expect(screen.getByTestId('arrival-cell').textContent?.trim()).toBeTruthy() // 进线时间
    expect(screen.getByTestId('recent-cell').textContent?.trim()).toBeTruthy() // 最近联系（PM 2026-10-30）
    expect(screen.getByTestId('channel-cell').textContent).toContain('电话')
    expect(screen.queryByText('+64211111111')).toBeNull()
    expect(screen.queryByText('FB 表单')).toBeNull()
    expect(screen.queryByText('Best of China')).toBeNull()
    expect(document.querySelectorAll('td').length).toBe(6) // ⭐ / 客人 / 进线 / 最近联系 / 该做什么 / 联系渠道
  })

  it('有 AI 摘要时，「该做什么」列显示摘要而不是规则那句（PM 2026-10-30）', () => {
    renderRow(makeRow({ suggestedChannel: 'phone', aiSummary: '客户想要 4 月上海团、约 10 人' }), true)
    expect(screen.getByTestId('ai-summary').textContent).toContain('客户想要 4 月上海团')
    expect(screen.queryByText('进线了，还没人联系')).toBeNull() // 规则那句被摘要顶掉
    expect(screen.getByText('打给他')).toBeTruthy() // 动作小标签还在
  })

  it('没有 AI 摘要时，退回规则那句', () => {
    renderRow(makeRow({ suggestedChannel: 'phone' }), true)
    expect(screen.queryByTestId('ai-summary')).toBeNull()
    expect(screen.getByText('进线了，还没人联系')).toBeTruthy()
  })

  it('每种渠道都有人话；没有可用渠道时直说，不画成空白', () => {
    const cases: Array<[NonNullable<ContactRow['suggestedChannel']>, string]> = [
      ['email', '邮件'],
      ['messenger', '私信'],
      ['sms', '短信'],
      ['none', '暂无可用渠道'],
    ]
    for (const [ch, text] of cases) {
      const { unmount } = renderRow(makeRow({ suggestedChannel: ch }), true)
      expect(screen.getByTestId('channel-cell').textContent).toContain(text)
      unmount()
    }
  })

  it('「回头」标签仍然画在名字旁边（最该先看的东西）', () => {
    renderRow(
      makeRow({ returning: { firstEnquiryAt: 'a', latestFormAt: 'b', ourLastContactAt: 'c', ourContacts: 1, earlierForms: 1 } }),
      true,
    )
    expect(screen.getByTestId('returning-tag')).toBeTruthy()
  })

  it('平铺名单（全部客人）不变：仍然画进线时间、联系方式、自定义列、来源标签', () => {
    renderRow(makeRow({ sources: ['fb_form'], custom: { tour: 'Best of China' } }), false)
    expect(screen.getByText('+64211111111')).toBeTruthy()
    expect(screen.getByText('FB 表单')).toBeTruthy()
    expect(screen.getByText('Best of China')).toBeTruthy()
    expect(screen.queryByTestId('channel-cell')).toBeNull()
  })
})

describe('📞 刚聊过标签（PM 2026-10-29：打完电话，这个人该标成正热着）', () => {
  it('刚打通聊上 → 名字旁出现「📞 刚聊过」', () => {
    renderRow(makeRow({ afterCall: true, reason: '刚通完电话（不到 1 小时前），还没记下一步' }))
    expect(screen.getByTestId('after-call-tag').textContent).toContain('刚聊过')
  })

  it('没有这个标记 → 不画', () => {
    renderRow(makeRow())
    expect(screen.queryByTestId('after-call-tag')).toBeNull()
  })
})
