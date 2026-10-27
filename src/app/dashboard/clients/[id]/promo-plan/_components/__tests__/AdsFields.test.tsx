/**
 * 「投放范围」这组输入框的真渲染测试。
 *
 * 为什么非要真渲染：这组字段的要害不在「填了什么」，而在**清空时写进去的是什么**。
 * 内容指纹用 Object.keys 枚举，键留着写成 undefined 会被序列化成 null，
 * 「加上又删掉」就跟「从来没填过」算出不同指纹 —— 已批准的计划会被判成
 * 「内容变过了」、人工核实记录跟着作废。纯函数测试测不到按钮真按下去那一下。
 */

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdsFields } from '../StepFields'
import type { PromoStep } from '@/lib/marketing-plan/promo/spec'

type AdsStep = Extract<PromoStep, { kind: 'ads_campaign' }>

function step(settings: Partial<AdsStep['settings']> = {}): AdsStep {
  return {
    id: 'step-1',
    kind: 'ads_campaign',
    settings: {
      ad_account_id: 'act_1',
      daily_budget_cents: 2000,
      audience_ref: '',
      creative_refs: [],
      placements: [],
      paused_ranges: [],
      ...settings,
    },
  }
}

const accounts = [{ id: 'act_1', cap_cents: 10000 }]

/** 渲染一次，返回最后一次 onChange 收到的步骤。 */
function renderFields(s: AdsStep) {
  const onChange = vi.fn()
  render(<AdsFields step={s} onChange={onChange} accounts={accounts} />)
  return { onChange, last: () => onChange.mock.calls[onChange.mock.calls.length - 1][0] as AdsStep }
}

describe('投放范围这组输入框', () => {
  it('默认不展开 —— 旧计划打开后不该凭空多出一个定向块', () => {
    renderFields(step())
    expect(screen.getByText('+ 加上')).toBeTruthy()
    expect(screen.queryByText('投哪些国家')).toBeNull()
  })

  it('点「+ 加上」才出现那几个输入框', () => {
    const { last } = renderFields(step())
    fireEvent.click(screen.getByText('+ 加上'))
    const s = last()
    expect(s.settings.targeting).toBeDefined()
    expect(s.settings.targeting?.countries).toEqual([])
  })

  it('界面上必须写明这里管不了「语言」定向', () => {
    renderFields(step())
    expect(screen.getByText(/语言/)).toBeTruthy()
  })
})

describe('点「删掉投放范围」时写进去的是什么', () => {
  it('⭐ 必须把 targeting 这个键真删掉，不许留成 undefined', () => {
    const { last } = renderFields(step({ targeting: { countries: ['NZ'], city_keys: [], excluded_audience_refs: [] } }))
    fireEvent.click(screen.getByText('删掉投放范围'))
    const s = last()
    expect('targeting' in s.settings).toBe(false)
  })
})

describe('年龄输入框清空时写进去的是什么', () => {
  it('⭐ 清空年龄下限必须把 age_min 这个键真删掉，不许留成 undefined', () => {
    const { last } = renderFields(step({ targeting: { countries: ['NZ'], city_keys: [], excluded_audience_refs: [], age_min: 55 } }))
    const input = screen.getByDisplayValue('55')
    fireEvent.change(input, { target: { value: '' } })
    const t = last().settings.targeting
    expect(t).toBeDefined()
    expect('age_min' in (t as Record<string, unknown>)).toBe(false)
  })

  it('填年龄下限能存成数字（不是字符串）', () => {
    const { last } = renderFields(step({ targeting: { countries: ['NZ'], city_keys: [], excluded_audience_refs: [] } }))
    fireEvent.change(screen.getByLabelText(/年龄下限/), { target: { value: '55' } })
    expect(last().settings.targeting?.age_min).toBe(55)
  })

  it('年龄填了非数字当没填，不写进去一个 0（0 会被 schema 判成低于 18）', () => {
    const { last } = renderFields(step({ targeting: { countries: ['NZ'], city_keys: [], excluded_audience_refs: [] } }))
    fireEvent.change(screen.getByLabelText(/年龄下限/), { target: { value: 'abc' } })
    const t = last().settings.targeting as Record<string, unknown>
    expect('age_min' in t).toBe(false)
  })
})

describe('国家码输入', () => {
  it('小写输入会被转成大写（schema 只收大写，手打 nz 不该被判错）', () => {
    const { last } = renderFields(step({ targeting: { countries: [], city_keys: [], excluded_audience_refs: [] } }))
    fireEvent.change(screen.getByLabelText(/投哪些国家/), { target: { value: 'nz, au' } })
    expect(last().settings.targeting?.countries).toEqual(['NZ', 'AU'])
  })
})
