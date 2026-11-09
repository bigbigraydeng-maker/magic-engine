// 边界测试:动作代码不引用 instagram 模块,也不出现客户名(平台共享;Reuse First)。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = __dirname
const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('转公开动作模块边界', () => {
  it('有源文件可检查', () => { expect(sources.length).toBeGreaterThan(5) })

  it.each(sources)('%s 不 import 任何 instagram 模块', (file) => {
    const imports = readFileSync(join(DIR, file), 'utf8').split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l))
    expect(imports.filter((l) => /instagram/i.test(l))).toEqual([])
  })

  it.each(sources)('%s 不含客户名', (file) => {
    expect(readFileSync(join(DIR, file), 'utf8')).not.toMatch(/\b(CTS|Oztop|Roman)\b/)
  })
})
