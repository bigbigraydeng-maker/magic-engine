import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImagePickerDialog, PICKER_PAGE_SIZE } from '../ImagePickerDialog'

function makeImages(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `https://img.test/${i}.jpg`)
}

describe('ImagePickerDialog', () => {
  it('renders a dialog with the accessible name equal to the title', () => {
    render(<ImagePickerDialog title="选主图" images={[]} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '选主图' })).toBeInTheDocument()
  })

  it('shows the empty message and no img when there are no images', () => {
    const { container } = render(
      <ImagePickerDialog title="选主图" images={[]} onPick={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByText('还没有可选的图片。')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('calls onPick with the src of the clicked image', () => {
    const onPick = vi.fn()
    const images = ['https://img.test/a.jpg', 'https://img.test/b.jpg']
    render(<ImagePickerDialog title="选主图" images={images} onPick={onPick} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('选这张图片 2'))
    expect(onPick).toHaveBeenCalledWith('https://img.test/b.jpg')
  })

  it('paginates 100 images in steps of PICKER_PAGE_SIZE', () => {
    const { container } = render(
      <ImagePickerDialog title="选主图" images={makeImages(100)} onPick={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(PICKER_PAGE_SIZE)
    expect(screen.getByText('已显示 48 / 100 张')).toBeInTheDocument()

    fireEvent.click(screen.getByText('显示更多'))
    expect(container.querySelectorAll('img')).toHaveLength(96)

    fireEvent.click(screen.getByText('显示更多'))
    expect(container.querySelectorAll('img')).toHaveLength(100)
    expect(screen.queryByText('显示更多')).toBeNull()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ImagePickerDialog title="选主图" images={[]} onPick={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when 关闭 is clicked', () => {
    const onClose = vi.fn()
    render(<ImagePickerDialog title="选主图" images={[]} onPick={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })
})
