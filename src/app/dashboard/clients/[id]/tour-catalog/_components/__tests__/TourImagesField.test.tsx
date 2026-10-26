import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  TourImagesField,
  STAFF_IMAGES_NOTICE,
  NEW_IMAGE_HELP,
  GALLERY_FULL_TEXT,
} from '../TourImagesField'
import { GALLERY_MAX } from '../tour-editor-form'
import type { FieldErrors } from '../editor-parts'

interface HarnessProps {
  pool: string[]
  initialHero?: string | null
  initialGallery?: string[]
  canAddUrl?: boolean
  errors?: FieldErrors
  onHero?: (next: string | null) => void
  onGallery?: (next: string[]) => void
}

function Harness(props: HarnessProps) {
  const {
    pool,
    initialHero = null,
    initialGallery = [],
    canAddUrl = false,
    errors = {},
    onHero = vi.fn(),
    onGallery = vi.fn(),
  } = props
  const [heroImage, setHeroImage] = useState<string | null>(initialHero)
  const [gallery, setGallery] = useState<string[]>(initialGallery)

  function handleHero(next: string | null) {
    setHeroImage(next)
    onHero(next)
  }
  function handleGallery(next: string[]) {
    setGallery(next)
    onGallery(next)
  }

  return (
    <TourImagesField
      tourName="Coral Loop"
      heroImage={heroImage}
      gallery={gallery}
      pool={pool}
      domain="example.test"
      canAddUrl={canAddUrl}
      errors={errors}
      onHeroChange={handleHero}
      onGalleryChange={handleGallery}
    />
  )
}

function pickerButtons(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter((button) => (button.getAttribute('aria-label') ?? '').startsWith('选这张图片'))
}

describe('TourImagesField staff view', () => {
  it('shows the staff notice with a mailto link and no new-image input', () => {
    render(<Harness pool={[]} canAddUrl={false} />)
    const notice = screen.getByTestId('staff-images-notice')
    expect(notice).toHaveTextContent(STAFF_IMAGES_NOTICE)
    const link = within(notice).getByRole('link')
    expect(link.getAttribute('href') ?? '').toMatch(/^mailto:/)
    expect(screen.queryByLabelText('填入新的图片地址')).toBeNull()
  })
})

describe('TourImagesField admin view', () => {
  it('shows the new-image input and help text and no staff notice', () => {
    render(<Harness pool={[]} canAddUrl />)
    expect(screen.queryByTestId('staff-images-notice')).toBeNull()
    expect(screen.getByLabelText('填入新的图片地址')).toBeInTheDocument()
    expect(screen.getByText(NEW_IMAGE_HELP)).toBeInTheDocument()
  })
})

describe('TourImagesField hero block', () => {
  it('shows the 还没有主图 placeholder when there is no hero', () => {
    render(<Harness pool={[]} />)
    const hero = screen.getByTestId('hero-image')
    expect(within(hero).getByText('还没有主图')).toBeInTheDocument()
  })

  it('shows the hero image with the tour name alt', () => {
    render(<Harness pool={[]} initialHero="https://img.test/hero.jpg" />)
    expect(screen.getByAltText('Coral Loop 主图')).toBeInTheDocument()
  })
})

describe('TourImagesField gallery block', () => {
  it('gives gallery thumbnails numbered alts', () => {
    render(<Harness pool={[]} initialGallery={['https://img.test/a.jpg', 'https://img.test/b.jpg']} />)
    expect(screen.getByAltText('Coral Loop 图片 1')).toBeInTheDocument()
    expect(screen.getByAltText('Coral Loop 图片 2')).toBeInTheDocument()
  })
})

describe('TourImagesField hero picker', () => {
  it('picks a hero from the pool and closes the dialog', () => {
    const onHero = vi.fn()
    const pool = ['https://img.test/a.jpg', 'https://img.test/b.jpg']
    render(<Harness pool={pool} initialHero="https://img.test/a.jpg" onHero={onHero} />)
    const hero = screen.getByTestId('hero-image')
    fireEvent.click(within(hero).getByText('从已有图片里选'))
    expect(screen.getByRole('dialog', { name: '选主图' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('选这张图片 1'))
    expect(onHero).toHaveBeenCalledWith('https://img.test/b.jpg')
    expect(screen.queryByRole('dialog', { name: '选主图' })).toBeNull()
  })
})

describe('TourImagesField gallery picker', () => {
  it('adds a picked image to the gallery and keeps the dialog open', () => {
    const onGallery = vi.fn()
    const pool = ['https://img.test/a.jpg', 'https://img.test/b.jpg', 'https://img.test/c.jpg']
    render(
      <Harness
        pool={pool}
        initialGallery={['https://img.test/a.jpg']}
        onGallery={onGallery}
      />,
    )
    const gallery = screen.getByTestId('gallery')
    fireEvent.click(within(gallery).getByText('从已有图片里选'))
    expect(screen.getByRole('dialog', { name: '选图加入图集' })).toBeInTheDocument()
    expect(pickerButtons()).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('选这张图片 1'))
    expect(onGallery).toHaveBeenLastCalledWith(['https://img.test/a.jpg', 'https://img.test/b.jpg'])
    expect(screen.getByRole('dialog', { name: '选图加入图集' })).toBeInTheDocument()
    expect(pickerButtons()).toHaveLength(1)
  })

  it('shows the empty message when the pool has nothing to add', () => {
    render(<Harness pool={['https://img.test/a.jpg']} initialGallery={['https://img.test/a.jpg']} />)
    const gallery = screen.getByTestId('gallery')
    fireEvent.click(within(gallery).getByText('从已有图片里选'))
    expect(screen.getByText('还没有可选的图片。')).toBeInTheDocument()
  })
})

describe('TourImagesField reorder and remove', () => {
  it('moves and removes gallery items', () => {
    const onGallery = vi.fn()
    const a = 'https://img.test/a.jpg'
    const b = 'https://img.test/b.jpg'
    const c = 'https://img.test/c.jpg'
    render(<Harness pool={[]} initialGallery={[a, b, c]} onGallery={onGallery} />)

    expect(screen.getByLabelText('前移第 1 张')).toBeDisabled()
    expect(screen.getByLabelText('后移第 3 张')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('后移第 1 张'))
    expect(onGallery).toHaveBeenLastCalledWith([b, a, c])

    fireEvent.click(screen.getByLabelText('前移第 3 张'))
    expect(onGallery).toHaveBeenLastCalledWith([b, c, a])

    fireEvent.click(screen.getByLabelText('移除第 1 张'))
    expect(onGallery).toHaveBeenLastCalledWith([c, a])
  })
})

describe('TourImagesField gallery limit', () => {
  it('disables adding when the gallery is full', () => {
    const full = Array.from({ length: GALLERY_MAX }, (_, i) => `https://img.test/${i}.jpg`)
    render(<Harness pool={[]} initialGallery={full} canAddUrl />)
    const gallery = screen.getByTestId('gallery')
    expect(within(gallery).getByText('从已有图片里选')).toBeDisabled()
    expect(screen.getByText(GALLERY_FULL_TEXT)).toBeInTheDocument()
    expect(screen.getByText('加入图集')).toBeDisabled()
  })
})

describe('TourImagesField new image block', () => {
  it('does not preview a typed address until it is added', () => {
    const onGallery = vi.fn()
    const { container } = render(<Harness pool={[]} canAddUrl onGallery={onGallery} />)
    const input = screen.getByLabelText('填入新的图片地址')
    fireEvent.change(input, { target: { value: 'https://img.test/new.jpg' } })
    expect(container.querySelectorAll('img')).toHaveLength(0)

    fireEvent.click(screen.getByText('加入图集'))
    expect(onGallery).toHaveBeenLastCalledWith(['https://img.test/new.jpg'])
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(input).toHaveValue('')
  })

  it('sets a typed site path as the hero and renders it joined with the domain', () => {
    const onHero = vi.fn()
    const { container } = render(<Harness pool={[]} canAddUrl onHero={onHero} />)
    const input = screen.getByLabelText('填入新的图片地址')
    fireEvent.change(input, { target: { value: '/images/hero.jpg' } })
    fireEvent.click(screen.getByText('设为主图'))
    expect(onHero).toHaveBeenLastCalledWith('/images/hero.jpg')
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://example.test/images/hero.jpg')
  })

  it('warns about a duplicate and does not call onGallery', () => {
    const onGallery = vi.fn()
    const a = 'https://img.test/a.jpg'
    render(<Harness pool={[]} initialGallery={[a]} canAddUrl onGallery={onGallery} />)
    const input = screen.getByLabelText('填入新的图片地址')
    fireEvent.change(input, { target: { value: a } })
    fireEvent.click(screen.getByText('加入图集'))
    expect(screen.getByText('这张已经在图集里了')).toBeInTheDocument()
    expect(onGallery).not.toHaveBeenCalled()
  })
})

describe('TourImagesField errors', () => {
  it('renders hero and gallery error messages', () => {
    render(
      <Harness
        pool={[]}
        errors={{ 'gallery[1]': '图片地址不符合要求', heroImage: '主图不对' }}
      />,
    )
    expect(screen.getByText('图片地址不符合要求')).toBeInTheDocument()
    expect(screen.getByText('主图不对')).toBeInTheDocument()
  })
})
