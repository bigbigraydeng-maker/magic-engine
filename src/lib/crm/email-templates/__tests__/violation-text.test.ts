import { describe, expect, it } from 'vitest'
import { describeBlock, describeMissing, describeWarning } from '../violation-text'

describe('describeMissing', () => {
  it('explains a missing first name', () => {
    expect(describeMissing('first_name')).toBe('客人的名字没有记录，称呼请在正文里手填。')
  })

  it('explains a missing sender name', () => {
    expect(describeMissing('sender_name')).toBe(
      '你的账号还没设置显示名，落款请在正文里手填（也可以请管理员在团队成员里补上显示名）。',
    )
  })

  it('explains a missing call time and names the button that fills it', () => {
    const text = describeMissing('call_when')
    expect(text).toContain('「几时通的电话」没有自动填上')
    expect(text).toContain('「刚和他通过电话」')
  })

  it('keeps the plain wording for any other name', () => {
    expect(describeMissing('input.note')).toBe('还缺：input.note')
  })
})

describe('describeBlock', () => {
  it('explains a leftover placeholder and quotes it', () => {
    expect(describeBlock({ code: 'placeholder_left', detail: '[Name]' })).toBe(
      '还有没填完的地方：「[Name]」。请填完，或连同括号一起去掉。',
    )
  })

  it('explains a link to a site that is not allowed, with no spacing hint for an ASCII host', () => {
    expect(describeBlock({ code: 'link_host_not_allowed', detail: 'evil.com' })).toBe('链接指向的网站不在允许范围内：evil.com。')
  })

  it('adds the spacing hint when the host has swallowed the text after the link', () => {
    const text = describeBlock({ code: 'link_host_not_allowed', detail: 'co.nz，欢迎浏览。有问题随时联系我' })
    expect(text).toContain('链接指向的网站不在允许范围内：co.nz，欢迎浏览。有问题随时联系我。')
    expect(text).toContain('请先空一格')
  })

  it('explains a host written with %-codes instead of printing the fixed word the gate uses for it', () => {
    expect(describeBlock({ code: 'link_host_not_allowed', detail: 'encoded host' })).toBe('链接里的网站地址被编码过（带 % 的写法），不能发；请直接写网址。')
  })

  it('explains a page that is not on sale, with its path when it is known', () => {
    expect(describeBlock({ code: 'tour_page_not_on_sale', detail: 'china/discovery/gone' })).toBe(
      '这个链接指向的页面现在没有在售（已下架、售完，或不是已发布的页面）：china/discovery/gone',
    )
  })

  it('and without echoing the English sentence when the page is not a published page at all', () => {
    const text = describeBlock({ code: 'tour_page_not_on_sale', detail: 'unrecognised page under the tours section' })
    expect(text).toBe('这个链接指向的页面现在没有在售（已下架、售完，或不是已发布的页面）')
    expect(text).not.toContain('unrecognised')
  })

  it('explains a departure date that is not on sale', () => {
    expect(describeBlock({ code: 'departure_not_on_sale', detail: 'china/discovery/essentials 2030-01-01' })).toBe(
      '这个链接里的出发日期现在没有在售：china/discovery/essentials 2030-01-01',
    )
  })

  it('explains an insecure link', () => {
    expect(describeBlock({ code: 'link_not_https', detail: 'http://a.co.nz' })).toBe('链接要用 https 开头：http://a.co.nz')
  })

  it('explains a link with a user name in it', () => {
    expect(describeBlock({ code: 'link_userinfo', detail: 'https://a@b.com' })).toBe('链接里不能带用户名或密码：https://a@b.com')
  })

  it('leaves any other violation as it was (a blocked phrase already carries its own sentence)', () => {
    expect(describeBlock({ code: 'content_blocked', detail: '不能写免签' })).toBe('不能写免签')
  })
})

describe('describeWarning', () => {
  it('explains an amount that is not in the catalog', () => {
    expect(describeWarning({ code: 'amount_not_in_catalog', detail: '$99' })).toBe('金额 $99 在已发布的目录里找不到，请核对是不是写错了。')
  })

  it('leaves any other warning as it was', () => {
    expect(describeWarning({ code: 'content_warning', detail: '注意措辞' })).toBe('注意措辞')
  })
})
