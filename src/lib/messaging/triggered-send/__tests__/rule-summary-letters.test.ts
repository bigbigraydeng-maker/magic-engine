/** P1-1: the plain-words summary says what the rule really judges (`gatesOf`), and a letter list lists its letters. */
import { describe, expect, it } from 'vitest'
import { describeRule } from '../rule-summary'
import { sendableRule } from './authorization-fakes'
import { CATALOGUE_URL, letterRule } from './letter-fakes'

describe('describeRule by the gates', () => {
  it('the welcome letter (no gates): the audience, "a person wrote = not sent", the old batch judged, the batch not counted', () => {
    const words = describeRule(sendableRule(), 20).join('\n')
    expect(words).toContain('谁会收到：Facebook 表单留资的新客人；只看最近 3 天进来的')
    expect(words).toContain('销售已经亲自写过信的客人不发')
    expect(words).toContain('已经收过的客人不发')
    expect(words).toContain('旧群发不算')
    expect(words).toContain('用的模板：auto-welcome')
  })

  it('🔴 a letter list: no audience line, each letter with template, catalogue link and its last day; the gates as switched', () => {
    const lines = describeRule(letterRule(), 10)
    const words = lines.join('\n')
    expect(words).not.toContain('Facebook 表单留资')
    expect(words).not.toContain('只看最近')
    expect(words).toContain('由 AI 跟进那边逐位点名')
    expect(lines).toContain(`· catalogue_2027：模板 auto-ai-catalogue 第 2 版；目录链接 ${CATALOGUE_URL}（2027-03-31 之后失效，过期这封就不发）`)
    expect(lines).toContain('· followup_d7：模板 auto-ai-d7 第 1 版；不带目录链接')
    expect(words).toContain('销售写过信不挡这封信')
    expect(words).toContain('旧群发也算')
    expect(words).toContain('收没收过旧欢迎信不影响这封信')
    expect(words).toContain('进来多久都可以发')
    expect(words).not.toContain('销售已经亲自写过信的客人不发')
  })
})
