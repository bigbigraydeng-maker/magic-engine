/**
 * 「点私信」广告那条开场白 —— 姓名 / 电话 / 邮箱到底取不取得出来。
 *
 * 第一条用例用的是 PM 2026-08-17 给的**线上真实格式**（标签、标点、行序一字未改），
 * 但姓名 / 电话 / 邮箱是虚构的 —— 真实客户资料不进仓库。
 */

import { describe, expect, it } from 'vitest'
import { parseLeadIntroMessage } from '../messenger-lead-intro'

/** 线上那条开场白的格式，字段值已替换成虚构数据。 */
const REAL = `Hello! I filled out your form and would like to know more about your business.
Full name: Jordan Avery
Phone number: 021 555 0134
Which tour interests you most?: Still deciding — show me all 4
Email: jordan.avery.example@example.com`

describe('线上那条真实开场白', () => {
  it('姓名 / 电话 / 邮箱三样都取得出来', () => {
    const r = parseLeadIntroMessage(REAL)
    expect(r).not.toBeNull()
    expect(r?.name).toBe('Jordan Avery')
    expect(r?.phone).toBe('021 555 0134')
    expect(r?.email).toBe('jordan.avery.example@example.com')
  })

  it('「感兴趣的团」也一起带出来 —— CRM 横表那一列读它', () => {
    expect(parseLeadIntroMessage(REAL)?.tourInterest).toBe('Still deciding — show me all 4')
  })

  it('第一行那句问候不会被当成字段', () => {
    // 那一行没有冒号，本来就匹配不上；这里钉住它不会跑进自定义问答里。
    const r = parseLeadIntroMessage(REAL)
    expect(Object.keys(r?.custom ?? {})).toEqual(['Which tour interests you most?'])
  })
})

describe('写法上的变体都要认', () => {
  it('标签大小写 / 下划线 / 多余空格', () => {
    const r = parseLeadIntroMessage('FULL_NAME:  Jane Doe \nPHONE:021 555 000\nEmail Address: j@x.com')
    expect(r?.name).toBe('Jane Doe')
    expect(r?.phone).toBe('021 555 000')
    expect(r?.email).toBe('j@x.com')
  })

  it('姓 + 名分成两行', () => {
    expect(parseLeadIntroMessage('First name: Jane\nLast name: Doe\nEmail: j@x.com')?.name).toBe(
      'Jane Doe',
    )
  })

  it('中文冒号 + 中文自定义问题', () => {
    const r = parseLeadIntroMessage('Full name: 陈小明\nEmail: chen@example.com\n想去哪个团？：丝绸之路')
    expect(r?.name).toBe('陈小明')
    expect(r?.custom['想去哪个团？']).toBe('丝绸之路')
  })

  it('值里再出现冒号 → 只在第一个冒号切开', () => {
    const r = parseLeadIntroMessage('Full name: Jane\nEmail: jane@example.com\nWhich tour?: 3:1 私家团')
    expect(r?.custom['Which tour?']).toBe('3:1 私家团')
  })
})

/**
 * 🔴 判据宁可窄：认不出来只是少补一条电话（现在就是这样），
 * **认错了会把别人的号码写进这个人的档案**。
 */
describe('不该认的一律不认', () => {
  it('普通聊天 → null', () => {
    expect(parseLeadIntroMessage('Hi, is the March tour still available?')).toBeNull()
    expect(parseLeadIntroMessage('好的，谢谢！')).toBeNull()
  })

  it('客人自己手打的号码 → 故意不认（歧义太大，交给销售看）', () => {
    expect(parseLeadIntroMessage('my number is 021 555 000, call me anytime')).toBeNull()
  })

  it('只有自定义问答、一条标准字段都没有 → null', () => {
    expect(parseLeadIntroMessage('Which tour interests you most?: Silk Road')).toBeNull()
  })

  /**
   * 🔴 **只有一条标准字段、又没有那句问候语 → 不认**（Codex 复审 2026-08-17）。
   * 客人在对话中途转发同行者的资料、贴一段邮件签名，都是这个形状 ——
   * 认了就会把**别人的号码**写进这个人的档案。
   */
  it('🔴 转发同行者的一行资料 → 不认', () => {
    expect(parseLeadIntroMessage('My friend is coming too. Phone: 021 555 999')).toBeNull()
    expect(parseLeadIntroMessage('Email: bob@example.com')).toBeNull()
  })

  /**
   * 🔴 **「my friend filled out the form」不是模板**（Codex 复审 2026-08-17）。
   * 那是客人转发同行者资料最自然的说法 —— 裸匹配会让它冒充开场白，
   * 把别人的号码写进这个人的档案。模板永远是开头的第一人称那一句。
   */
  it('🔴「my friend filled out the form」+ 同行者资料 → 不认', () => {
    const forwarded = 'my friend filled out the form\nName: Sam Riley\nPhone: 021 555 999'
    expect(parseLeadIntroMessage(forwarded, { requireMarker: true })).toBeNull()
  })

  it('带着那句问候语时，一条标准字段也认（那就是真的表单开场白）', () => {
    const r = parseLeadIntroMessage(
      'Hello! I filled out your form and would like to know more about your business.\nEmail: bob@example.com',
    )
    expect(r?.email).toBe('bob@example.com')
  })

  it('标签在但值是空的 → 不算', () => {
    expect(parseLeadIntroMessage('Full name:\nPhone number:   ')).toBeNull()
  })

  it('空 / null / undefined 不炸', () => {
    expect(parseLeadIntroMessage('')).toBeNull()
    expect(parseLeadIntroMessage(null)).toBeNull()
    expect(parseLeadIntroMessage(undefined)).toBeNull()
  })

  /**
   * 一段随手写的话里正好有个冒号，不能被读成字段。
   * `LINE_RE` 限定标签 ≤ 60 字符，且必须命中标准字段才返回。
   */
  it('句子里的冒号不会变成字段', () => {
    expect(
      parseLeadIntroMessage('Just so you know: we are travelling with two kids and a grandma'),
    ).toBeNull()
  })
})
