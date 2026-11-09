import { describe, expect, it } from 'vitest'
import { preserveOriginalName } from '../brief-display-name'

describe('preserveOriginalName', () => {
  it('旧摘要开头的中文音译姓名改回 CRM 原始英文名', () => {
    expect(preserveOriginalName('客户大卫·斯科特通过表单联系了 CTS。', 'David Scott'))
      .toBe('客户 David Scott 通过表单联系了 CTS。')
  })

  it('没有明显音译或原名本身是中文时不猜也不改', () => {
    expect(preserveOriginalName('客户询问上海团。', 'David Scott')).toBe('客户询问上海团。')
    expect(preserveOriginalName('客户李小明表示感兴趣。', '李小明')).toBe('客户李小明表示感兴趣。')
    expect(preserveOriginalName('客户王女士和大卫·斯科特联系了我们。', 'David Scott'))
      .toBe('客户王女士和大卫·斯科特联系了我们。')
  })
})
