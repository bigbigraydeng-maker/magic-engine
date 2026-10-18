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
