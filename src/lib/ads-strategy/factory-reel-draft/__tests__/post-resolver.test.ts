import { describe, expect, it, vi } from 'vitest'

import {
  PUBLISHED_POSTS_FIELDS,
  PUBLISHED_POSTS_LIMIT,
  resolvePromotablePostId,
  type GraphGetResult,
  type PostResolverDeps,
} from '../post-resolver'

const PAGE_ID = '111111'
const VIDEO_ID = '222222'

function makeDeps(result: GraphGetResult): {
  deps: PostResolverDeps
  graphGet: ReturnType<typeof vi.fn>
} {
  const graphGet = vi.fn(async () => result)
  return { deps: { graphGet }, graphGet }
}

function expectCalledOnce(graphGet: ReturnType<typeof vi.fn>): void {
  expect(graphGet).toHaveBeenCalledTimes(1)
  expect(graphGet).toHaveBeenCalledWith(`/${PAGE_ID}/published_posts`, {
    fields: PUBLISHED_POSTS_FIELDS,
    limit: String(PUBLISHED_POSTS_LIMIT),
  })
}

describe('resolvePromotablePostId', () => {
  it('matches by attachments.data[0].target.id === videoId', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result).toEqual({ ok: true, postId: '111111_999', matchedBy: 'attachment_target' })
    expectCalledOnce(graphGet)
  })

  it('returns the post id even when it differs from the video id', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result).toEqual({ ok: true, postId: '111111_999', matchedBy: 'attachment_target' })
    expect(result.ok && result.postId).not.toBe('111111_222222')
    expectCalledOnce(graphGet)
  })

  it('matches only by attachment url /reel/<videoId>/', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ url: 'https://www.facebook.com/reel/222222/' }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result).toEqual({ ok: true, postId: '111111_999', matchedBy: 'attachment_url' })
    expectCalledOnce(graphGet)
  })

  it('does not match a url with a longer number that merely starts with the video id', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ url: 'https://www.facebook.com/reel/2222229999/' }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('no_match')
    expectCalledOnce(graphGet)
  })

  it('returns no_match when no post matches', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: '555555' } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('no_match')
    expectCalledOnce(graphGet)
  })

  it('returns ambiguous when two different posts match', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
          {
            id: '111111_888',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('ambiguous')
    expectCalledOnce(graphGet)
  })

  it('returns ok when the same post is listed twice', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result).toEqual({ ok: true, postId: '111111_999', matchedBy: 'attachment_target' })
    expectCalledOnce(graphGet)
  })

  it('returns page_mismatch when the matching post belongs to another page', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          {
            id: '333333_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('page_mismatch')
    expectCalledOnce(graphGet)
  })

  it('returns graph_error when graphGet resolves ok:false', async () => {
    const { deps, graphGet } = makeDeps({ ok: false, status: 400, body: null })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('graph_error')
    expect(result.ok === false && result.message).toContain('400')
    expectCalledOnce(graphGet)
  })

  it('returns graph_error when graphGet rejects', async () => {
    const graphGet = vi.fn(async () => {
      throw new Error('network down')
    })
    const deps: PostResolverDeps = { graphGet }

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('graph_error')
    expect(result.ok === false && result.message).toContain('network down')
    expectCalledOnce(graphGet)
  })

  it('returns bad_shape when body is null', async () => {
    const { deps, graphGet } = makeDeps({ ok: true, status: 200, body: null })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('bad_shape')
    expectCalledOnce(graphGet)
  })

  it('returns bad_shape when data is not an array', async () => {
    const { deps, graphGet } = makeDeps({ ok: true, status: 200, body: { data: 'nope' } })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('bad_shape')
    expectCalledOnce(graphGet)
  })

  it('skips posts with no attachments or malformed ids without throwing', async () => {
    const { deps, graphGet } = makeDeps({
      ok: true,
      status: 200,
      body: {
        data: [
          { id: 'not-a-post-id' },
          { id: '111111_777' },
          { id: '111111_666', attachments: {} },
          { id: '111111_555', attachments: { data: 'nope' } },
          { id: '111111_444', attachments: { data: [null, 'x', { target: { id: '999999' } }] } },
          {
            id: '111111_999',
            attachments: { data: [{ target: { id: VIDEO_ID } }] },
          },
        ],
      },
    })

    const result = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: VIDEO_ID })

    expect(result).toEqual({ ok: true, postId: '111111_999', matchedBy: 'attachment_target' })
    expectCalledOnce(graphGet)
  })

  it('returns bad_input and does not call graphGet for invalid pageId or videoId', async () => {
    const { deps, graphGet } = makeDeps({ ok: true, status: 200, body: { data: [] } })

    const badPage = await resolvePromotablePostId(deps, { pageId: 'abc', videoId: VIDEO_ID })
    expect(badPage.ok).toBe(false)
    expect(badPage.ok === false && badPage.reason).toBe('bad_input')

    const emptyPage = await resolvePromotablePostId(deps, { pageId: '', videoId: VIDEO_ID })
    expect(emptyPage.ok).toBe(false)
    expect(emptyPage.ok === false && emptyPage.reason).toBe('bad_input')

    const badVideo = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: 'abc' })
    expect(badVideo.ok).toBe(false)
    expect(badVideo.ok === false && badVideo.reason).toBe('bad_input')

    const emptyVideo = await resolvePromotablePostId(deps, { pageId: PAGE_ID, videoId: '' })
    expect(emptyVideo.ok).toBe(false)
    expect(emptyVideo.ok === false && emptyVideo.reason).toBe('bad_input')

    expect(graphGet).not.toHaveBeenCalled()
  })
})
