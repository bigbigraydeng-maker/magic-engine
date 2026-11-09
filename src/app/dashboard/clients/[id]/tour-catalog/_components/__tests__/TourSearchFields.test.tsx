import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TourSearchFields, QUICK_ANSWER_HELP, TAGS_FULL_TEXT } from '../TourSearchFields'
import { TAG_MAX } from '../tour-editor-form'
import type { FieldErrors } from '../editor-parts'

interface HarnessProps {
  initialMetaTitle?: string
  initialMetaDescription?: string
  initialQuickAnswer?: string
  initialTags?: string[]
  errors?: FieldErrors
  onMetaTitle: (next: string) => void
  onMetaDescription: (next: string) => void
  onQuickAnswer: (next: string) => void
  onTags: (next: string[]) => void
}

function Harness(props: HarnessProps) {
  const {
    initialMetaTitle = '',
    initialMetaDescription = '',
    initialQuickAnswer = '',
    initialTags = [],
    errors = {},
    onMetaTitle,
    onMetaDescription,
    onQuickAnswer,
    onTags,
  } = props
  const [metaTitle, setMetaTitle] = useState(initialMetaTitle)
  const [metaDescription, setMetaDescription] = useState(initialMetaDescription)
  const [quickAnswer, setQuickAnswer] = useState(initialQuickAnswer)
  const [tags, setTags] = useState<string[]>(initialTags)
  return (
    <TourSearchFields
      metaTitle={metaTitle}
      metaDescription={metaDescription}
      quickAnswer={quickAnswer}
      tags={tags}
      errors={errors}
      onMetaTitle={(next) => {
        onMetaTitle(next)
        setMetaTitle(next)
      }}
      onMetaDescription={(next) => {
        onMetaDescription(next)
        setMetaDescription(next)
      }}
      onQuickAnswer={(next) => {
        onQuickAnswer(next)
        setQuickAnswer(next)
      }}
      onTags={(next) => {
        onTags(next)
        setTags(next)
      }}
    />
  )
}

function noopSpies() {
  return {
    onMetaTitle: vi.fn(),
    onMetaDescription: vi.fn(),
    onQuickAnswer: vi.fn(),
    onTags: vi.fn(),
  }
}

describe('TourSearchFields', () => {
  it('shows character counters and the quick answer help', () => {
    const spies = noopSpies()
    render(
      <Harness
        initialMetaTitle="abc"
        initialMetaDescription=""
        initialQuickAnswer="hello"
        {...spies}
      />,
    )

    expect(screen.getByText('3/120')).toBeInTheDocument()
    expect(screen.getByText('0/400')).toBeInTheDocument()
    expect(screen.getByText('5/1500')).toBeInTheDocument()
    expect(screen.getByText(QUICK_ANSWER_HELP)).toBeInTheDocument()
  })

  it('calls the matching callback when typing', () => {
    const spies = noopSpies()
    render(<Harness {...spies} />)

    fireEvent.change(screen.getByLabelText('搜索标题'), { target: { value: '标题' } })
    expect(spies.onMetaTitle).toHaveBeenLastCalledWith('标题')

    fireEvent.change(screen.getByLabelText('搜索描述'), { target: { value: '描述' } })
    expect(spies.onMetaDescription).toHaveBeenLastCalledWith('描述')

    fireEvent.change(screen.getByLabelText('快速回答'), { target: { value: '回答' } })
    expect(spies.onQuickAnswer).toHaveBeenLastCalledWith('回答')
  })

  it('adds a tag via the button and clears the input', () => {
    const spies = noopSpies()
    render(<Harness initialTags={['china']} {...spies} />)

    expect(screen.getAllByTestId('tag-chip')).toHaveLength(1)

    const input = screen.getByLabelText('新标签')
    fireEvent.change(input, { target: { value: 'silk road' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect(spies.onTags).toHaveBeenLastCalledWith(['china', 'silk road'])
    expect(input).toHaveValue('')
    expect(screen.getAllByTestId('tag-chip')).toHaveLength(2)
  })

  it('adds a tag with the Enter key', () => {
    const spies = noopSpies()
    render(<Harness initialTags={['china']} {...spies} />)

    const input = screen.getByLabelText('新标签')
    fireEvent.change(input, { target: { value: 'silk road' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(spies.onTags).toHaveBeenLastCalledWith(['china', 'silk road'])
  })

  it('ignores duplicate and blank tags', () => {
    const spies = noopSpies()
    render(<Harness initialTags={['china']} {...spies} />)

    const input = screen.getByLabelText('新标签')

    fireEvent.change(input, { target: { value: 'china' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(spies.onTags).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(spies.onTags).not.toHaveBeenCalled()
  })

  it('removes a tag', () => {
    const spies = noopSpies()
    render(<Harness initialTags={['china', 'silk road']} {...spies} />)

    fireEvent.click(screen.getByRole('button', { name: '移除标签 china' }))

    expect(spies.onTags).toHaveBeenLastCalledWith(['silk road'])
  })

  it('disables adding at the tag limit and shows the full text', () => {
    const spies = noopSpies()
    const tags = Array.from({ length: TAG_MAX }, (_, i) => `tag-${i}`)
    render(<Harness initialTags={tags} {...spies} />)

    expect(screen.getByLabelText('新标签')).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
    expect(screen.getByText(TAGS_FULL_TEXT)).toBeInTheDocument()
  })

  it('renders field errors', () => {
    const spies = noopSpies()
    const errors: FieldErrors = { metaTitle: '太长了', 'tags[2]': '标签写法不对' }
    render(<Harness errors={errors} {...spies} />)

    expect(screen.getByText('太长了')).toBeInTheDocument()
    expect(screen.getByText('标签写法不对')).toBeInTheDocument()
  })
})
