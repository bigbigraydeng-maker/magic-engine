/**
 * 🔴 缺口①（PO 授权 corrective，2026-08-17）：今日卡的联系动作 `ReachAction`
 * 对「别再联系(DNC)」的人必须**整块 return null** —— 好号不给可点拨号、坏号也不给
 * 「先发邮件/私信」的换渠道怂恿。
 *
 * 这行是防御纵深（DNC 人今天多半掉出名单），但搜索视图会把冻结在名单上的
 * DNC 人铺成卡片走到这里（狄仁杰实施后复审确认）。属「声明了≠接上了」的
 * 未测安全码，必须直测钉住 —— 删掉那行 return null，本文件的 DNC 用例会转红。
 */

import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReachAction, type Row } from '../page'

const row = (over: Partial<Row> = {}): Row => ({
  contactId: 'c1',
  name: 'Sue Masson',
  phone: '+64211234567',
  email: 'sue@example.com',
  stage: null,
  stageLabel: null,
  segment: 'nurture_future',
  temperature: 'off',
  reason: '',
  suggestedChannel: 'phone',
  dueAt: null,
  lastTouchAt: null,
  lastNote: null,
  pinned: false,
  pinnedAt: null,
  suggestedStage: null,
  ...over,
})

const dialLink = () =>
  Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href')?.startsWith('tel:'))

describe('ReachAction：拒联的人一个联系动作都不给', () => {
  it('🔴 DNC + 好号 → 不渲染可点拨号（整块 return null）', () => {
    render(<ReachAction row={row({ doNotContact: true, suggestedChannel: 'phone' })} />)
    expect(dialLink()).toBeUndefined()
  })

  it('🔴 DNC + 坏号 → 不渲染「先发邮件/私信」的换渠道怂恿', () => {
    render(
      <ReachAction
        row={row({ doNotContact: true, phoneUnusable: true, suggestedChannel: 'email' })}
      />,
    )
    expect(screen.queryByText(/这个号打不通/)).toBeNull()
  })

  it('非DNC + 好号 → 照旧给可点拨号（防误绿：不是永远不渲染）', () => {
    render(<ReachAction row={row({ suggestedChannel: 'phone' })} />)
    expect(dialLink()).toBeTruthy()
  })

  it('非DNC + 坏号 → 照旧给「先发邮件」提示（没误伤正常坏号）', () => {
    render(<ReachAction row={row({ phoneUnusable: true, suggestedChannel: 'email' })} />)
    expect(screen.getByText(/这个号打不通/)).toBeTruthy()
  })
})
