/**
 * 每日广告成绩单面板（修复方案第 1 刀 ②）。只读显示：
 *  - 三种「没有数字」分开写：还没成绩单 / 算出错 / 某格未知；
 *  - 预算判断三态（错配 / 没错配 / 还差几个）和判不了的原因都写成人话；
 *  - 数据不全的日子不写「该多给钱」，只写「先不判加钱」；
 *  - 「不出结果」要分开：真不出结果（视频播放）vs 说不清是拉新还是再营销（子牙 2026-11-03 P2）。
 */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import ScorecardPanel, { budgetLines, unitNote } from '../scorecard-panel'
import type { AdsScorecard, BudgetVerdict, ScorecardUnit } from '@/lib/ads-strategy/portfolio/scorecard'

afterEach(() => cleanup())

function unit(over: Partial<ScorecardUnit>): ScorecardUnit {
  return {
    adAccountId: 'act_7274', level: 'adset', id: 'A', name: '组A', role: 'acquisition', spend: 398.12,
    resultType: 'lead', results: 67, costPerResult: 5.94, targetCost: 11, vsTarget: 'at_or_below', sampleGap: 0, separate: null,
    ...over,
  }
}

function verdict(over: Partial<BudgetVerdict>): BudgetVerdict {
  return {
    adAccountId: 'act_7274', role: 'acquisition', state: 'no_mismatch', reason: null, threshold: 0.15, fdrQ: 0.1,
    maxGap: 0.14, under: [], over: [], overHeld: [], thin: [], notLikeForLike: [],
    ...over,
  }
}

function card(over: Partial<AdsScorecard> = {}): AdsScorecard {
  return {
    window: { start: '2026-10-26', end: '2026-11-01' }, completeness: 'complete',
    units: [unit({}), unit({ id: 'D', name: '组D', spend: 50.51, results: 4, costPerResult: 12.63, vsTarget: 'above', sampleGap: 1 })],
    budget: [verdict({})], accountsSkipped: [],
    ...over,
  }
}

const name = (id: string) => ({ A: '组A', C: '组C', W: '组W' }[id] ?? id)

describe('预算判断写成人话', () => {
  it('没错配：写出最大差距和门槛', () => {
    expect(budgetLines(verdict({}), name)).toEqual(['钱分得跟结果对得上（各组最大差距 14%，差距超过 15% 且统计上站得住才算错配）'])
  })

  it('差距过了门槛、但统计上站不住（样本小）→ 不写「对得上」', () => {
    const lines = budgetLines(verdict({ maxGap: 0.215 }), name)
    expect(lines).toEqual(['没判错配：各组最大差距 22%，超过 15%，但结果数还少，统计上还不能确定是错配'])
    expect(lines.join('')).not.toContain('对得上')
  })

  it('错配：花多了 / 给少了分开写', () => {
    expect(budgetLines(verdict({ state: 'mismatch', under: ['C'], over: ['A'] }), name)).toEqual([
      '钱跟结果对不上', '花得多、结果少：组C', '结果多、钱给少了：组A',
    ])
  })

  it('数据不全：不写「钱给少了」，只写先不判加钱', () => {
    const lines = budgetLines(verdict({ state: 'mismatch', under: ['C'], overHeld: ['A'] }), name)
    expect(lines).toContain('结果多，但今天数据不全，先不判加钱：组A')
    expect(lines.join('')).not.toContain('钱给少了')
  })

  it('对得上 / 对不上时，样本不够、没进比较的组也写出来', () => {
    const thin = [{ id: 'C', name: '组C', results: 0, need: 5, suspicious: true, notLikeForLike: false }]
    expect(budgetLines(verdict({ thin }), name)[1]).toBe('样本还不够、没进这次比较：组C 还差 5 个（看起来差距大，数量太少还判不了）')
    expect(budgetLines(verdict({ thin: [{ ...thin[0], suspicious: false }] }), name)[1]).toBe('样本还不够、没进这次比较：组C 还差 5 个')
    expect(budgetLines(verdict({ state: 'mismatch', under: ['A'], thin }), name)).toContain('样本还不够、没进这次比较：组C 还差 5 个（看起来差距大，数量太少还判不了）')
    expect(budgetLines(verdict({ state: 'insufficient', thin }), name)).toEqual(['样本还不够，判不了', '组C 还差 5 个'])
  })

  it('样本不够：列出每个组还差几个', () => {
    const v = verdict({ state: 'insufficient', thin: [{ id: 'C', name: '组C', results: 2, need: 3, suspicious: false, notLikeForLike: false }] })
    expect(budgetLines(v, name)).toEqual(['样本还不够，判不了', '组C 还差 3 个'])
  })

  it('判不了：三种原因各自一句', () => {
    expect(budgetLines(verdict({ state: 'not_comparable', reason: 'single_unit' }), name)[0]).toBe('只有一个组在花钱，没得比')
    expect(budgetLines(verdict({ state: 'not_comparable', reason: 'outcome_not_configured' }), name)[0]).toBe('还没设置「广告结果怎么算」，判不了')
    expect(budgetLines(verdict({ state: 'not_comparable', reason: 'primary_not_attributable' }), name)[0]).toBe('有组的结果归不到具体哪个组，判不了')
  })

  it('非同类组进了比较：任何状态都补一句「只作参考」', () => {
    const lines = budgetLines(verdict({ notLikeForLike: ['W'] }), name)
    expect(lines[1]).toBe('注意：组W 结果种类跟主结果不同或判不出，系统仍按主结果拿它比，这条结论只作参考')
  })
})

describe('单列的组写清楚为什么', () => {
  it('视频播放组 vs 说不清角色的组，分开写', () => {
    expect(unitNote(unit({ separate: 'not_result_unit', role: 'awareness' }))).toBe('不出结果（比如视频播放），不进预算比较')
    expect(unitNote(unit({ separate: 'not_result_unit', role: 'unknown' }))).toBe('说不清这个组是拉新还是再营销，没进预算比较')
    expect(unitNote(unit({ separate: 'not_result_unit', role: 'mixed' }))).toBe('说不清这个组是拉新还是再营销，没进预算比较')
  })

  it('其余几种单列', () => {
    expect(unitNote(unit({ separate: 'result_type_differs' }))).toBe('结果种类跟客户主结果不一样（预算比较里仍按主结果数，只作参考）')
    expect(unitNote(unit({ separate: 'mixed_result_types' }))).toBe('系列下各组结果种类混着，按主结果数')
    expect(unitNote(unit({ separate: 'result_type_unknown' }))).toBe('判不出结果种类（比如网站转化），按主结果数')
    expect(unitNote(unit({ separate: 'experiment' }))).toBe('对照测试中，不进预算比较')
    expect(unitNote(unit({}))).toBe('')
  })
})

describe('面板', () => {
  it('还没有成绩单 / 算出错：分开写，不画空表', () => {
    render(<ScorecardPanel scorecard={undefined} />)
    expect(screen.getByText('今天还没有成绩单：每天的广告巡察跑过一次才会出现。')).toBeTruthy()
    cleanup()
    const { container } = render(<ScorecardPanel scorecard={{ error: 'boom' }} />)
    expect(screen.getByText('成绩单今天没算出来（boom），页面其余判断不受影响。')).toBeTruthy()
    expect(container.querySelector('table')).toBeNull()
  })

  it('每个组一行，花得多的在前；结果、成本、跟目标比、样本都写出来', () => {
    const { container } = render(<ScorecardPanel scorecard={card({ units: [card().units[1], card().units[0]] })} />)
    const rows = [...container.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent))
    expect(rows[0]).toEqual(['组A', '$398.12', '67 个留资（表单）', '$5.94', '不高于目标 $11.00', '够了'])
    expect(rows[1]).toEqual(['组D', '$50.51', '4 个留资（表单）', '$12.63', '高于目标 $11.00', '还差 1 个'])
    expect(screen.getByText('获客：钱分得跟结果对得上（各组最大差距 14%，差距超过 15% 且统计上站得住才算错配）')).toBeTruthy()
  })

  it('结果未知就写未知，不写 0；系列分钱、按主结果数的组标出来', () => {
    const { container } = render(<ScorecardPanel scorecard={card({ units: [
      unit({ results: null, costPerResult: null, vsTarget: null, sampleGap: null }),
      unit({ id: 'cbo', name: '系列X', level: 'campaign', spend: 10, resultType: null, results: 14, separate: 'mixed_result_types', vsTarget: 'no_target', targetCost: null }),
    ] })} />)
    const rows = [...container.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent))
    expect(rows[0].slice(2, 6)).toEqual(['未知', '—', '—', '未知'])
    expect(rows[1].slice(0, 3)).toEqual(['系列X （整个系列分钱）系列下各组结果种类混着，按主结果数', '$10.00', '14 个（按主结果数）'])
    expect(rows[1][4]).toBe('不跟目标比')
  })

  it('数据不全的日子顶上写一句', () => {
    render(<ScorecardPanel scorecard={card({ completeness: 'partial' })} />)
    expect(screen.getByText('今天广告数据没拉全：只写哪里钱花多了，「该多给钱」今天先不判。')).toBeTruthy()
  })

  it('两个账户时每条判断带账户尾号；被跳过的账户写原因', () => {
    render(<ScorecardPanel scorecard={card({
      budget: [verdict({}), verdict({ adAccountId: 'act_9999', state: 'not_comparable', reason: 'single_unit', maxGap: null })],
      accountsSkipped: [{ adAccountId: 'act_5555', reason: 'shared' }],
    })} />)
    expect(screen.getByText('获客 · 账户 …7274：钱分得跟结果对得上（各组最大差距 14%，差距超过 15% 且统计上站得住才算错配）')).toBeTruthy()
    expect(screen.getByText('获客 · 账户 …9999：只有一个组在花钱，没得比')).toBeTruthy()
    expect(screen.getByText(/账户 …5555 没算：这个账户登记给了不止一个客户/)).toBeTruthy()
  })

  it('没名字的组写「未命名组 …尾号」，视频播放组的结果格写「—」不写未知', () => {
    const { container } = render(<ScorecardPanel scorecard={card({ units: [
      unit({ id: '120200001234', name: null }),
      unit({ id: 'V', name: '视频组', spend: 1, role: 'awareness', resultType: null, results: null, costPerResult: null, vsTarget: 'no_target', targetCost: null, sampleGap: null, separate: 'not_result_unit' }),
    ], budget: [verdict({ state: 'mismatch', under: ['120200001234'] })] })} />)
    const rows = [...container.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent))
    expect(rows[0][0]).toBe('未命名组 …001234')
    expect(screen.getByText('花得多、结果少：未命名组 …001234')).toBeTruthy()
    expect(rows[1][2]).toBe('—')
  })

  it('错配那条判断用组名，不用编号', () => {
    render(<ScorecardPanel scorecard={card({ budget: [verdict({ state: 'mismatch', under: ['D'], over: ['A'] })] })} />)
    expect(screen.getByText('花得多、结果少：组D')).toBeTruthy()
    expect(screen.getByText('结果多、钱给少了：组A')).toBeTruthy()
  })
})
