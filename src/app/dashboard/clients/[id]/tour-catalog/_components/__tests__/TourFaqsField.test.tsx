import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TourFaqsField, FAQ_FULL_TEXT } from '../TourFaqsField'
import { FAQ_MAX, type FaqDraft } from '../tour-editor-form'
import type { FieldErrors } from '../editor-parts'

function emptyFaq(): FaqDraft {
  return { question: '', answer: '', href: '', label: '' }
}

function Harness(props: {
  initial: FaqDraft[]
  errors?: FieldErrors
  onChange: (next: FaqDraft[]) => void
}) {
  const { initial, errors = {}, onChange } = props
  const [faqs, setFaqs] = useState<FaqDraft[]>(initial)
  return (
    <TourFaqsField
      faqs={faqs}
      errors={errors}
      onChange={(next) => {
        onChange(next)
        setFaqs(next)
      }}
    />
  )
}

describe('TourFaqsField', () => {
  it('shows the empty message and adds an empty draft', () => {
    const onChange = vi.fn()
    render(<Harness initial={[]} onChange={onChange} />)

    expect(screen.getByText('还没有常见问题。')).toBeInTheDocument()
    expect(screen.queryAllByTestId('faq-item')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '加一条问题' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith([emptyFaq()])
    expect(screen.getAllByTestId('faq-item')).toHaveLength(1)
  })

  it('carries all four values when editing', () => {
    const onChange = vi.fn()
    render(<Harness initial={[emptyFaq()]} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('问题 1'), { target: { value: 'Q1' } })
    fireEvent.change(screen.getByLabelText('回答 1'), { target: { value: 'A1' } })
    fireEvent.change(screen.getByLabelText('链接 1'), { target: { value: '/tours/x' } })
    fireEvent.change(screen.getByLabelText('链接文字 1'), { target: { value: '看这里' } })

    expect(onChange).toHaveBeenLastCalledWith([
      { question: 'Q1', answer: 'A1', href: '/tours/x', label: '看这里' },
    ])
  })

  it('moves faqs down and up and disables the ends', () => {
    const onChange = vi.fn()
    const initial: FaqDraft[] = [
      { question: 'Q1', answer: '', href: '', label: '' },
      { question: 'Q2', answer: '', href: '', label: '' },
      { question: 'Q3', answer: '', href: '', label: '' },
    ]
    render(<Harness initial={initial} onChange={onChange} />)

    expect(screen.getByRole('button', { name: '上移第 1 条' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下移第 3 条' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '下移第 1 条' }))
    expect(onChange).toHaveBeenLastCalledWith([
      { question: 'Q2', answer: '', href: '', label: '' },
      { question: 'Q1', answer: '', href: '', label: '' },
      { question: 'Q3', answer: '', href: '', label: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: '上移第 3 条' }))
    expect(onChange).toHaveBeenLastCalledWith([
      { question: 'Q2', answer: '', href: '', label: '' },
      { question: 'Q3', answer: '', href: '', label: '' },
      { question: 'Q1', answer: '', href: '', label: '' },
    ])
  })

  it('deletes a faq', () => {
    const onChange = vi.fn()
    const initial: FaqDraft[] = [
      { question: 'Q1', answer: '', href: '', label: '' },
      { question: 'Q2', answer: '', href: '', label: '' },
      { question: 'Q3', answer: '', href: '', label: '' },
    ]
    render(<Harness initial={initial} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '删除第 2 条' }))

    expect(onChange).toHaveBeenLastCalledWith([
      { question: 'Q1', answer: '', href: '', label: '' },
      { question: 'Q3', answer: '', href: '', label: '' },
    ])
  })

  it('disables adding at the limit and shows the full text', () => {
    const onChange = vi.fn()
    const initial: FaqDraft[] = Array.from({ length: FAQ_MAX }, () => emptyFaq())
    render(<Harness initial={initial} onChange={onChange} />)

    expect(screen.getByRole('button', { name: '加一条问题' })).toBeDisabled()
    expect(screen.getByText(FAQ_FULL_TEXT)).toBeInTheDocument()
  })

  it('renders field errors in the right cards', () => {
    const onChange = vi.fn()
    const errors: FieldErrors = {
      'faqs[0].link.href': '链接不对',
      'faqs[1].question': '必填',
      faqs: '条数太多',
    }
    render(<Harness initial={[emptyFaq(), emptyFaq()]} errors={errors} onChange={onChange} />)

    expect(screen.getByText('链接不对')).toBeInTheDocument()
    expect(screen.getByText('必填')).toBeInTheDocument()
    expect(screen.getByText('条数太多')).toBeInTheDocument()

    const cards = screen.getAllByTestId('faq-item')
    expect(within(cards[0]).getByText('链接不对')).toBeInTheDocument()
    expect(within(cards[1]).getByText('必填')).toBeInTheDocument()
  })
})
