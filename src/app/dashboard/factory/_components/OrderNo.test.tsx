// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { OrderNo } from './OrderNo'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FULL_ID = 'e8c5b66a-1111-2222-3333-444455556666'
const SHORT_ID = 'e8c5b66a'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const mount = async () => {
  const div = document.body.appendChild(document.createElement('div'))
  await act(async () => {
    createRoot(div).render(<OrderNo id={FULL_ID} />)
  })
  return div
}

const clickButton = async () => {
  const button = document.querySelector('button')
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

it('renders the first 8 characters of the id', async () => {
  await mount()
  expect(document.body.textContent).toContain(`工单 ${SHORT_ID}`)
  expect(document.body.textContent).not.toContain(FULL_ID)
})

it('copies the short id and shows the copied state', async () => {
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  await mount()
  await clickButton()
  expect(writeText).toHaveBeenCalledWith(SHORT_ID)
  expect(document.body.textContent).toContain('已复制 ✓')
})

it('shows a failure message when writeText rejects', async () => {
  const writeText = vi.fn(async () => {
    throw new Error('denied')
  })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  const execCommand = vi.fn(() => false)
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
  })
  await mount()
  await clickButton()
  expect(document.body.textContent).toContain('复制失败')
})

it('shows a failure message when clipboard is undefined', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  })
  const execCommand = vi.fn(() => false)
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
  })
  await mount()
  await clickButton()
  expect(document.body.textContent).toContain('复制失败')
})

it('falls back to execCommand when clipboard is undefined', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  })
  const execCommand = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
  })
  await mount()
  await clickButton()
  expect(execCommand).toHaveBeenCalledWith('copy')
  expect(document.body.textContent).toContain('已复制 ✓')
})
