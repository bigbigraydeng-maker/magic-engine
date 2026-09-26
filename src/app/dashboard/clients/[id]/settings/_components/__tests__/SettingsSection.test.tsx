/**
 * 板块外壳的收起/展开（2026-09-15 加的）。
 *
 * PM 走完整个配置中心页面反馈「信息量太大」——分页签（见 SettingsTabs.test.ts）
 * 解决了「23 个板块堆一列」，但最重的一组自己还剩 11 个板块全部摊开，一样是
 * 一列从头看到底。这里钉的是「大多数板块默认收起」这条新规矩，以及一条
 * 不能破的老规矩：**收起的板块不许挂载**，不然又是「藏起来但照样发请求」
 * 这个已经踩过一次的坑（见 SettingsTabs.tsx 文件头）。
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsSection } from '../SettingsTabs'

describe('默认收起，除非是第一块或者明确要求展开', () => {
  it('first 的板块默认展开', () => {
    render(
      <SettingsSection icon="🚦" title="第一块" first>
        <p>内容</p>
      </SettingsSection>,
    )
    expect(screen.getByText('内容')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('defaultOpen 的板块（比如授权回跳正对着它）默认展开', () => {
    render(
      <SettingsSection icon="✉️" title="公司邮箱" defaultOpen>
        <p>内容</p>
      </SettingsSection>,
    )
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('普通板块默认收起，看不到内容', () => {
    render(
      <SettingsSection icon="📦" title="主力产品">
        <p>内容</p>
      </SettingsSection>,
    )
    expect(screen.queryByText('内容')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('收起 ≠ 藏起来 —— 收起时子组件必须没挂载，不能只是 CSS 隐藏', () => {
  it('收起状态下，子组件的副作用（比如 fetch）不会被触发', () => {
    const onMount = vi.fn()
    function ChildWithEffect() {
      onMount()
      return <p>子组件内容</p>
    }
    render(
      <SettingsSection icon="📦" title="主力产品">
        <ChildWithEffect />
      </SettingsSection>,
    )
    expect(onMount).not.toHaveBeenCalled()
  })

  it('点开之后子组件才挂载，且只挂载一次', async () => {
    const onMount = vi.fn()
    function ChildWithEffect() {
      onMount()
      return <p>子组件内容</p>
    }
    render(
      <SettingsSection icon="📦" title="主力产品">
        <ChildWithEffect />
      </SettingsSection>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText('子组件内容')).toBeInTheDocument()
    expect(onMount).toHaveBeenCalledTimes(1)
  })
})

describe('点开之后再收起，内容留着，不会重新拉一次数据', () => {
  it('收起-再展开不会让子组件重新挂载', async () => {
    const onMount = vi.fn()
    function ChildWithEffect() {
      onMount()
      return <p>子组件内容</p>
    }
    render(
      <SettingsSection icon="📦" title="主力产品">
        <ChildWithEffect />
      </SettingsSection>,
    )
    const toggle = screen.getByRole('button')
    await userEvent.click(toggle) // 展开，第一次挂载
    await userEvent.click(toggle) // 收起
    await userEvent.click(toggle) // 再展开

    expect(onMount).toHaveBeenCalledTimes(1)
  })

  it('收起时内容用 hidden 藏起来，不是从 DOM 里整块拔掉', async () => {
    render(
      <SettingsSection icon="📦" title="主力产品">
        <p>内容</p>
      </SettingsSection>,
    )
    const toggle = screen.getByRole('button')
    await userEvent.click(toggle)
    await userEvent.click(toggle)

    // 收起后内容还在 DOM 里（子组件状态没丢），只是不可见。
    expect(screen.getByText('内容')).toBeInTheDocument()
    expect(screen.getByText('内容').parentElement).toHaveClass('hidden')
  })
})
