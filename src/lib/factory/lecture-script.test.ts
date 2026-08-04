import { describe, expect, it } from 'vitest'
import { regionMismatch, spokenDiversionViolations, xhsCtaViolations } from './lecture-script'

describe('xhsCtaViolations(严格版·纯 CTA 字段)', () => {
  it('私信/微信/whatsapp 全拦', () => {
    expect(xhsCtaViolations('关注我，私信送资料')).toContain('私信')
    expect(xhsCtaViolations('加微信聊')).toContain('微信')
    expect(xhsCtaViolations('WhatsApp me')).toContain('whatsapp')
  })
  it('干净 CTA 放行', () => {
    expect(xhsCtaViolations('关注我，主页合集看全系列')).toEqual([])
  })
})

describe('spokenDiversionViolations(宽松版·口播)', () => {
  it('冲观众喊的导流句式拦住', () => {
    expect(spokenDiversionViolations('想要模板的私信我')).toContain('私信我')
    expect(spokenDiversionViolations('加我微信拉你进群')).toContain('加我微信')
    expect(spokenDiversionViolations('评论区扣1')).toContain('扣1')
  })
  it('正当教学内容不误杀', () => {
    // 描述工具功能 / 描述现状，不是导流
    expect(spokenDiversionViolations('用 Manychat 自动私信发一份问卷收集需求')).toEqual([])
    expect(spokenDiversionViolations('大多数小生意获客靠微信朋友圈和老客户介绍')).toEqual([])
    expect(spokenDiversionViolations('发一条 WhatsApp 提醒给你自己')).toEqual([])
  })
})

describe('regionMismatch(标题地域 vs 内容地域)', () => {
  it('真实事故:标题写澳洲、内容全是新西兰 → 拦住', () => {
    const msg = regionMismatch({
      title: '澳洲华人做生意，为什么现在必须用AI获客',
      body: '打开 Google Maps 搜 Auckland plumber，惠灵顿的会计师也一样，新西兰本地客户都这么搜',
    })
    expect(msg).toContain('澳洲')
    expect(msg).toContain('新西兰')
  })

  it('一致 → 放行', () => {
    expect(regionMismatch({
      title: '新西兰华人做生意必须用AI获客',
      body: '搜 Auckland plumber，奥克兰本地客户都这么找',
    })).toBeNull()
  })

  it('标题没提地域 → 放行', () => {
    expect(regionMismatch({ title: '用AI读懂客户', body: '奥克兰的客户会这样搜' })).toBeNull()
  })

  it('真的在做两地对比 → 不误杀', () => {
    expect(regionMismatch({
      title: '澳洲和新西兰的打法差在哪',
      body: '悉尼的客户这样搜，奥克兰的客户那样搜',
    })).toBeNull()
  })
})
