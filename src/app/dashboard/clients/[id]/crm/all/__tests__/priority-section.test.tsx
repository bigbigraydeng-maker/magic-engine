import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { shortHint, PrioritySectionHeader } from '../_components/PrioritySection'

const LONG_HINT =
  '先打前 20 个，按紧急程度从上往下；后面的排队等着，打完前面的自然往上顶'

describe('shortHint', () => {
  it('只留最前面那一小截', () => {
    expect(shortHint(LONG_HINT)).toBe('先打前 20')
  })

  it('12 个字以内原样返回', () => {
    expect(shortHint('今天必须有人回')).toBe('今天必须有人回')
  })

  it('没有分隔符的长句只做 trim，不改内容', () => {
    const noSeparator = '  这是一句没有任何分隔符的很长很长的说明文字  '
    expect(shortHint(noSeparator)).toBe(noSeparator.trim())
  })

  it('第一个分句为空时不会返回空字符串', () => {
    const result = shortHint('，后面还有话')
    expect(result).not.toBe('')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('PrioritySectionHeader', () => {
  it('渲染段名、人数、今日进度和截断后的说明', () => {
    render(
      <table>
        <tbody>
          <PrioritySectionHeader
            title="今天要联系"
            hint={LONG_HINT}
            total={374}
            progress={{ total: 100, done: 2, left: 98 }}
            open
            colSpan={6}
            onToggle={vi.fn()}
          />
        </tbody>
      </table>,
    )

    expect(screen.getByText('今天要联系')).toBeDefined()
    expect(screen.getByText('374 人')).toBeDefined()
    expect(screen.getByText(/今天动过 2 · 还剩 98/)).toBeDefined()

    const hintSpan = screen.getByText('先打前 20')
    expect(hintSpan).toBeDefined()
    expect(hintSpan.getAttribute('title')).toBe(LONG_HINT)
  })
})
