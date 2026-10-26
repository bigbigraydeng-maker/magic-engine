/**
 * The editor's folding groups and the two tiers of fields: a client's own staff (canEditSite false)
 * and a Magic Engine admin (canEditSite true). The server refuses on its own; these tests pin what
 * the page shows and, above all, which keys a save sends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TourEditor, SITE_FIELDS_BY_ME_TEXT } from '../TourEditor'
import { CatalogUiProvider, type CatalogUi } from '../catalog-context'
import { SOLD_OUT_CONFIRM_TEXT } from '../TourBasicsFields'
import { IMAGE_ERROR_TEXT, SITE_ONLY_TEXT, UNKNOWN_FIELD_ERROR_TEXT } from '../tour-editor-form'
import { STAFF_IMAGES_NOTICE } from '../TourImagesField'
import { REVIEWS_WARNING } from '../TourReviewFields'
import type { CatalogTourView } from '../types'

const A = 'https://img.test/a.jpg'
const B = 'https://img.test/b.jpg'
const C = '/images/c.jpg'
const LOGO = { src: '/images/air.png', alt: 'Air Atlantis' }

function makeTour(overrides: Partial<CatalogTourView> = {}): CatalogTourView {
  return {
    id: 'tour-1',
    slug: 'tour-1',
    destination: 'atlantis',
    tier: 'gold',
    name: 'Coral Loop',
    displayPriceText: 'From NZD $4,999 per person',
    isActive: true,
    managesDepartures: true,
    title: 'Coral Loop 12 Days',
    shortDescription: 'A loop around the reef',
    durationText: '2 Days',
    highlights: ['Reef', 'Lagoon'],
    itinerary: [
      { day: 1, title: 'Arrive', description: 'Transfer', meals: ['Dinner'], accommodation: 'Reef Hotel', operatorLogo: LOGO },
      { day: 2, title: 'Lagoon', description: 'Boat', festiveLabel: 'Christmas Day' },
    ],
    inclusions: ['Flights'],
    exclusions: ['Tips'],
    tourCities: ['Port Coral'],
    singleSupplement: 'NZD 800',
    maxGroupSize: 20,
    heroImage: A,
    gallery: [A, B, C],
    metaTitle: 'Coral Loop tour',
    metaDescription: 'Twelve days',
    tags: ['reef'],
    faqs: [
      { question: 'Q1', answer: 'A1', link: null },
      { question: 'Q2', answer: 'A2', link: { href: '/tours/reef', label: 'Reef tours' } },
    ],
    soldOut: false,
    singleSupplementNote: null,
    rating: 4.4,
    reviewCount: 12,
    reviewSummary: 'Loved it',
    quickAnswer: 'A short answer',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const ADMIN_UI: CatalogUi = {
  channelsConnected: false,
  canPublish: true,
  canEditSite: true,
  siteDomain: 'example.test',
  imagePool: [A, B, C, 'https://img.test/d.jpg'],
}
const STAFF_UI: CatalogUi = { ...ADMIN_UI, canPublish: false, canEditSite: false }

function renderEditor(ui: CatalogUi, tour: CatalogTourView = makeTour()) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tour }))
  vi.stubGlobal('fetch', fetchMock)
  const utils = render(
    <CatalogUiProvider value={ui}>
      <TourEditor clientId="c1" tour={tour} onSaved={vi.fn()} onCancel={vi.fn()} />
    </CatalogUiProvider>,
  )
  return { ...utils, fetchMock }
}

async function savedPatch(fetchMock: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return (JSON.parse(String(init.body)) as { patch: Record<string, unknown> }).patch
}

function group(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-group="${id}"]`)
  if (!el) throw new Error(`group ${id} is not rendered`)
  return el
}

function groupToggle(id: string): HTMLElement {
  return within(group(id)).getAllByRole('button')[0]
}

beforeEach(() => {
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TourEditor groups', () => {
  it('admin sees all seven groups, only 基本信息 unfolded', () => {
    renderEditor(ADMIN_UI)
    const ids = Array.from(document.querySelectorAll('[data-group]')).map((el) => el.getAttribute('data-group'))
    expect(ids).toEqual(['basics', 'images', 'itinerary', 'inclusions', 'faqs', 'search', 'reviews'])
    expect(groupToggle('basics')).toHaveAttribute('aria-expanded', 'true')
    for (const id of ['images', 'itinerary', 'inclusions', 'faqs', 'search', 'reviews']) {
      expect(groupToggle(id)).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.getByText(REVIEWS_WARNING)).toBeInTheDocument()
    expect(screen.getByLabelText('填入新的图片地址')).toBeInTheDocument()
    expect(screen.queryByTestId('site-fields-note')).toBeNull()
    expect(screen.queryByTestId('staff-images-notice')).toBeNull()
  })

  it('folds and unfolds a group from its heading', () => {
    renderEditor(ADMIN_UI)
    const toggle = groupToggle('itinerary')
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(body).toHaveAttribute('hidden')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(body).not.toHaveAttribute('hidden')
    fireEvent.click(toggle)
    expect(body).toHaveAttribute('hidden')
  })

  it('staff do not get the three site groups nor the new-address box, and are told who maintains them', () => {
    renderEditor(STAFF_UI)
    const ids = Array.from(document.querySelectorAll('[data-group]')).map((el) => el.getAttribute('data-group'))
    expect(ids).toEqual(['basics', 'images', 'itinerary', 'inclusions'])
    expect(screen.queryByLabelText('搜索标题')).toBeNull()
    expect(screen.queryByLabelText('评分')).toBeNull()
    expect(screen.queryByText('加一条问题')).toBeNull()
    expect(screen.queryByLabelText('新标签')).toBeNull()
    expect(screen.queryByLabelText('填入新的图片地址')).toBeNull()

    const note = screen.getByTestId('site-fields-note')
    expect(note).toHaveTextContent(SITE_FIELDS_BY_ME_TEXT)
    expect(within(note).getByRole('link').getAttribute('href')).toMatch(/^mailto:hello@magicengine\.cloud/)
    expect(screen.getByTestId('staff-images-notice')).toHaveTextContent(STAFF_IMAGES_NOTICE)
  })

  it('marks a group with unsaved edits, and clears the mark when the edit is undone', () => {
    renderEditor(ADMIN_UI)
    expect(screen.queryByTestId('group-dirty-search')).toBeNull()
    fireEvent.change(screen.getByLabelText('搜索标题'), { target: { value: 'New title' } })
    expect(screen.getByTestId('group-dirty-search')).toBeInTheDocument()
    expect(screen.queryByTestId('group-dirty-basics')).toBeNull()
    fireEvent.change(screen.getByLabelText('搜索标题'), { target: { value: 'Coral Loop tour' } })
    expect(screen.queryByTestId('group-dirty-search')).toBeNull()
  })
})

describe('TourEditor sends only what changed', () => {
  it('staff changing the description send that key and nothing they cannot see', async () => {
    const { fetchMock } = renderEditor(STAFF_UI)
    fireEvent.change(screen.getByDisplayValue('A loop around the reef'), { target: { value: 'A new intro' } })
    const patch = await savedPatch(fetchMock)
    expect(patch).toEqual({ shortDescription: 'A new intro' })
    for (const key of ['faqs', 'tags', 'rating', 'reviewCount', 'reviewSummary', 'metaTitle', 'metaDescription', 'quickAnswer', 'heroImage', 'gallery', 'itinerary', 'soldOut']) {
      expect(patch).not.toHaveProperty(key)
    }
  })

  it('the single-supplement note is its own key', async () => {
    const { fetchMock } = renderEditor(STAFF_UI)
    const input = within(group('basics')).getByText('单房差说明').parentElement?.querySelector('input')
    if (!input) throw new Error('note input missing')
    fireEvent.change(input, { target: { value: 'Waived when sharing' } })
    expect(await savedPatch(fetchMock)).toEqual({ singleSupplementNote: 'Waived when sharing' })
  })

  it('admin fields: search, quick answer, tags, rating, review count and summary', async () => {
    const { fetchMock } = renderEditor(ADMIN_UI)
    fireEvent.change(screen.getByLabelText('搜索标题'), { target: { value: 'T' } })
    fireEvent.change(screen.getByLabelText('搜索描述'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('快速回答'), { target: { value: 'Short' } })
    fireEvent.change(screen.getByLabelText('新标签'), { target: { value: 'lagoon' } })
    fireEvent.click(screen.getByRole('button', { name: '添加', hidden: true }))
    fireEvent.change(screen.getByLabelText('评分'), { target: { value: '4.6' } })
    fireEvent.change(screen.getByLabelText('评价数'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('评价摘要'), { target: { value: 'Great' } })
    expect(await savedPatch(fetchMock)).toEqual({
      metaTitle: 'T',
      metaDescription: null,
      quickAnswer: 'Short',
      tags: ['reef', 'lagoon'],
      rating: 4.6,
      reviewCount: null,
      reviewSummary: 'Great',
    })
  })

  it('removing a tag sends the shorter list', async () => {
    const { fetchMock } = renderEditor(ADMIN_UI)
    fireEvent.click(screen.getByLabelText('移除标签 reef'))
    expect(await savedPatch(fetchMock)).toEqual({ tags: [] })
  })

  it('FAQs: add, edit, move and delete end up in the saved order with links', async () => {
    const { fetchMock } = renderEditor(ADMIN_UI)
    fireEvent.click(screen.getByText('加一条问题'))
    fireEvent.change(screen.getByLabelText('问题 3'), { target: { value: ' Q3 ' } })
    fireEvent.change(screen.getByLabelText('回答 3'), { target: { value: 'A3' } })
    fireEvent.click(screen.getByLabelText('上移第 3 条'))
    fireEvent.click(screen.getByLabelText('删除第 1 条'))
    expect(await savedPatch(fetchMock)).toEqual({
      faqs: [
        { question: 'Q3', answer: 'A3', link: null },
        { question: 'Q2', answer: 'A2', link: { href: '/tours/reef', label: 'Reef tours' } },
      ],
    })
  })
})

describe('TourEditor itinerary extras', () => {
  it('shows the operator mark read-only and prefills stay and festive mark', () => {
    renderEditor(STAFF_UI)
    expect(screen.getByLabelText('第 1 天住宿')).toHaveValue('Reef Hotel')
    expect(screen.getByLabelText('第 2 天节日标记')).toHaveValue('Christmas Day')
    const notes = screen.getAllByTestId('operator-logo-note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveTextContent('这一天带航司标志：Air Atlantis')
    expect(screen.getByText(/如 Christmas Day，会显示成一个小标签/)).toBeInTheDocument()
  })

  it('saving the itinerary sends every day back with its operator mark untouched', async () => {
    const { fetchMock } = renderEditor(STAFF_UI)
    fireEvent.change(screen.getByLabelText('第 2 天住宿'), { target: { value: 'Lagoon Lodge' } })
    fireEvent.change(screen.getByLabelText('第 2 天节日标记'), { target: { value: '' } })
    expect(await savedPatch(fetchMock)).toEqual({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Transfer', meals: ['Dinner'], accommodation: 'Reef Hotel', operatorLogo: LOGO },
        { day: 2, title: 'Lagoon', description: 'Boat', accommodation: 'Lagoon Lodge' },
      ],
    })
  })

  it('a new day carries no stay, festive mark or operator mark', async () => {
    const { fetchMock } = renderEditor(STAFF_UI)
    fireEvent.click(screen.getByText('加一天'))
    const patch = await savedPatch(fetchMock)
    expect((patch.itinerary as unknown[])[2]).toEqual({ day: 3, title: '', description: '' })
  })
})

describe('TourEditor sold-out switch', () => {
  it('asks before turning on, and leaves it off when declined', () => {
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)
    renderEditor(STAFF_UI)
    const box = screen.getByLabelText('整团售罄')
    fireEvent.click(box)
    expect(confirmMock).toHaveBeenCalledWith(SOLD_OUT_CONFIRM_TEXT)
    expect(box).not.toBeChecked()
    expect(screen.getByText(/打开后，这个团在上架后的目录里标为售罄，页面还在但不再销售/)).toBeInTheDocument()
  })

  it('saves soldOut once confirmed, and does not ask when turning it off', async () => {
    const confirmMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmMock)
    const { fetchMock } = renderEditor(STAFF_UI)
    fireEvent.click(screen.getByLabelText('整团售罄'))
    expect(screen.getByLabelText('整团售罄')).toBeChecked()
    expect(await savedPatch(fetchMock)).toEqual({ soldOut: true })
  })

  it('turning it off needs no confirmation', () => {
    const confirmMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmMock)
    renderEditor(STAFF_UI, makeTour({ soldOut: true }))
    fireEvent.click(screen.getByLabelText('整团售罄'))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('整团售罄')).not.toBeChecked()
  })
})

describe('TourEditor images', () => {
  it('reordering and removing gallery images sends the new order', async () => {
    const { fetchMock } = renderEditor(STAFF_UI)
    fireEvent.click(screen.getByLabelText('后移第 1 张'))
    fireEvent.click(screen.getByLabelText('移除第 3 张'))
    expect(await savedPatch(fetchMock)).toEqual({ gallery: [B, A] })
  })

  it('staff pick the hero and add to the gallery from existing images only', async () => {
    const { fetchMock } = renderEditor(STAFF_UI)
    fireEvent.click(within(screen.getByTestId('hero-image')).getByText('从已有图片里选'))
    fireEvent.click(screen.getByLabelText('选这张图片 1'))
    fireEvent.click(within(screen.getByTestId('gallery')).getByText('从已有图片里选'))
    // Only the one pool image that is not in the gallery yet is offered.
    expect(screen.getAllByLabelText(/^选这张图片/)).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('选这张图片 1'))
    expect(await savedPatch(fetchMock)).toEqual({
      heroImage: B,
      gallery: [A, B, C, 'https://img.test/d.jpg'],
    })
  })

  it('site paths are joined to the registered domain only', () => {
    renderEditor(STAFF_UI)
    expect(screen.getByAltText('Coral Loop 图片 3')).toHaveAttribute('src', 'https://example.test/images/c.jpg')
  })

  it('admin can type a new address; it is not shown as an image until added', async () => {
    const { fetchMock, container } = renderEditor(ADMIN_UI, makeTour({ gallery: [], heroImage: null }))
    fireEvent.change(screen.getByLabelText('填入新的图片地址'), { target: { value: 'https://new.test/x.jpg' } })
    expect(container.querySelectorAll('img')).toHaveLength(0)
    fireEvent.click(screen.getByText('加入图集'))
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(await savedPatch(fetchMock)).toEqual({ gallery: ['https://new.test/x.jpg'] })
  })
})

describe('TourEditor refused saves', () => {
  async function refuse(status: number, body: unknown, ui: CatalogUi = ADMIN_UI) {
    const utils = renderEditor(ui)
    utils.fetchMock.mockResolvedValue(jsonResponse(status, body))
    fireEvent.change(screen.getByDisplayValue('Coral Loop'), { target: { value: 'Coral Loop 2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(utils.fetchMock).toHaveBeenCalledTimes(1))
    return utils
  }

  it('unfolds every group that holds a red message and marks it', async () => {
    await refuse(400, {
      error: 'invalid_fields',
      fields: [
        { field: 'gallery[2]', code: 'image_not_allowed' },
        { field: 'faqs[1].link.href', code: 'invalid_link' },
        { field: 'itinerary[1].accommodation', code: 'invalid_characters' },
        { field: 'rating', code: 'invalid_rating' },
      ],
    })
    await screen.findByRole('alert')
    for (const id of ['images', 'faqs', 'itinerary', 'reviews']) {
      expect(groupToggle(id)).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId(`group-error-${id}`)).toBeInTheDocument()
    }
    expect(groupToggle('search')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('group-error-search')).toBeNull()
    expect(screen.queryByTestId('group-error-basics')).toBeNull()

    expect(within(group('images')).getByText(IMAGE_ERROR_TEXT)).toBeInTheDocument()
    expect(within(screen.getAllByTestId('faq-item')[1]).getByText('链接要写成站内路径，例如 /tours/china-highlights')).toBeInTheDocument()
    expect(within(group('itinerary')).getByText('这里不能出现 < 或 >')).toBeInTheDocument()
    expect(within(group('reviews')).getByText('评分要填 0 到 5，最多一位小数')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('有 4 项填得不对，已跳到第一处')
  })

  it.each([
    ['invalid_image_url', IMAGE_ERROR_TEXT],
    ['image_not_allowed', IMAGE_ERROR_TEXT],
    ['too_many_items', '条数太多'],
    ['item_too_long', '某一条太长了'],
  ])('gallery error %s reads as plain Chinese', async (code, text) => {
    await refuse(400, { error: 'invalid_fields', fields: [{ field: 'gallery', code }] })
    expect(await within(group('images')).findByText(text)).toBeInTheDocument()
    expect(screen.queryByText(code)).toBeNull()
  })

  it('invalid_number on the review fields names their own range, not the group-size one', async () => {
    await refuse(400, {
      error: 'invalid_fields',
      fields: [
        { field: 'rating', code: 'invalid_number' },
        { field: 'reviewCount', code: 'invalid_number' },
        { field: 'tags[1]', code: 'duplicate_tag' },
        { field: 'itinerary[0].operatorLogo.src', code: 'invalid_image_url' },
      ],
    })
    expect(await within(group('reviews')).findByText('评分要填 0 到 5，最多一位小数')).toBeInTheDocument()
    expect(within(group('reviews')).getByText('评价数要填不小于 0 的整数')).toBeInTheDocument()
    expect(within(group('search')).getByText('这个标签已经有了')).toBeInTheDocument()
    expect(within(group('itinerary')).getByText(IMAGE_ERROR_TEXT)).toBeInTheDocument()
  })

  it('an error code the page does not know becomes one generic sentence, never the raw code', async () => {
    await refuse(400, { error: 'invalid_fields', fields: [{ field: 'tags[0]', code: 'brand_new_code' }] })
    expect(await within(group('search')).findByText(UNKNOWN_FIELD_ERROR_TEXT)).toBeInTheDocument()
    expect(screen.queryByText('brand_new_code')).toBeNull()
    expect(groupToggle('search')).toHaveAttribute('aria-expanded', 'true')
  })

  it('403 says only Magic Engine may change this, whatever the code', async () => {
    await refuse(403, { error: 'forbidden' }, STAFF_UI)
    expect(await screen.findByText(SITE_ONLY_TEXT)).toBeInTheDocument()
    expect(screen.queryByText('forbidden')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an unknown top-level failure is the generic save failure, not the raw code', async () => {
    await refuse(500, { error: 'boom' })
    expect(await screen.findByText('保存失败，请稍后重试')).toBeInTheDocument()
    expect(screen.queryByText('boom')).toBeNull()
  })
})
