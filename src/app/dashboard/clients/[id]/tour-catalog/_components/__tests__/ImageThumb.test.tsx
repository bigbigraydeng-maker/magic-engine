import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImageThumb, ImagePlaceholder, resolveImageUrl } from '../ImageThumb'

describe('resolveImageUrl', () => {
  it('returns https URLs unchanged', () => {
    expect(resolveImageUrl('https://cdn.test/a.jpg', 'example.test')).toBe('https://cdn.test/a.jpg')
  })

  it('joins a site path with the domain', () => {
    expect(resolveImageUrl('/images/a.jpg', 'example.test')).toBe('https://example.test/images/a.jpg')
  })

  it('cleans a domain given as a full URL with a path', () => {
    expect(resolveImageUrl('/images/a.jpg', 'https://Example.test/path')).toBe('https://example.test/images/a.jpg')
  })

  it('returns null when the domain is null or empty', () => {
    expect(resolveImageUrl('/images/a.jpg', null)).toBeNull()
    expect(resolveImageUrl('/images/a.jpg', '')).toBeNull()
  })

  it('returns null for a domain with illegal characters', () => {
    expect(resolveImageUrl('/images/a.jpg', 'exa mple.test')).toBeNull()
    expect(resolveImageUrl('/images/a.jpg', 'evil.test?x')).toBeNull()
  })

  it('returns null for non-compliant addresses', () => {
    expect(resolveImageUrl('http://x/a.jpg', 'example.test')).toBeNull()
    expect(resolveImageUrl('javascript:alert(1)', 'example.test')).toBeNull()
    expect(resolveImageUrl('//evil.test/a.jpg', 'example.test')).toBeNull()
    expect(resolveImageUrl('/other/a.jpg', 'example.test')).toBeNull()
  })
})

describe('ImageThumb', () => {
  it('renders an img with the expected attributes', () => {
    const { container } = render(<ImageThumb src="https://cdn.test/a.jpg" alt="一张图" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveAttribute('decoding', 'async')
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img).toHaveAttribute('width', '96')
    expect(img).toHaveAttribute('height', '72')
    expect(img?.className).toContain('object-cover')
    expect(screen.getByAltText('一张图')).toBeInTheDocument()
  })

  it('joins a site path with the domain in the src attribute', () => {
    const { container } = render(<ImageThumb src="/images/a.jpg" alt="站内" domain="example.test" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://example.test/images/a.jpg')
  })

  it('shows the 站内图片 placeholder when a site path has no domain', () => {
    const { container } = render(<ImageThumb src="/images/a.jpg" alt="站内" domain={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('image-placeholder')).toHaveTextContent('站内图片')
  })

  it('shows the 地址不合规 placeholder for a non-compliant address', () => {
    const { container } = render(<ImageThumb src="http://x.test/a.jpg" alt="坏地址" domain="example.test" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('image-placeholder')).toHaveTextContent('地址不合规')
  })

  it('shows the 图片打不开 placeholder after an error', () => {
    const { container } = render(<ImageThumb src="https://cdn.test/a.jpg" alt="一张图" />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('image-placeholder')).toHaveTextContent('图片打不开')
  })

  it('uses 160x120 dimensions for size lg', () => {
    const { container } = render(<ImageThumb src="https://cdn.test/a.jpg" alt="大图" size="lg" />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('width', '160')
    expect(img).toHaveAttribute('height', '120')
  })
})

describe('ImagePlaceholder', () => {
  it('renders the given text', () => {
    render(<ImagePlaceholder text="占位" />)
    expect(screen.getByTestId('image-placeholder')).toHaveTextContent('占位')
  })
})
