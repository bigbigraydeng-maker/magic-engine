/**
 * publishPagePhotoPost + deletePagePost — Graph adapter guarantees.
 *
 * These tests lock how we translate our intent into Graph's contract, and how
 * we read Graph's responses back. Both are one-shot: no retry (would double-
 * post), errors thrown for the caller to decide, and idempotent "already gone"
 * for delete so a re-run doesn't look like a failure.
 */

import { describe, expect, it, vi } from 'vitest'
import { publishPagePhotoPost, deletePagePost, readPageStoryId } from '../page-posts'

const PAGE = '1616575215312482'
const TOKEN = 'page-access-token'

function fakeFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: async () => response.body,
    }
  })
  return { fetcher: fn as unknown as typeof fetch, calls }
}

describe('publishPagePhotoPost — immediate vs scheduled', () => {
  it('immediate publish sends published:true and no scheduled_publish_time', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { post_id: '1_2', id: 'photo' } })
    await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg', fetcher,
    })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.published).toBe(true)
    expect(body.scheduled_publish_time).toBeUndefined()
  })

  it('🔴 scheduled publish sends published:false + a unix timestamp — the pair Facebook requires', async () => {
    // published:false alone would create a hidden draft. Both fields together
    // are what tells Facebook to auto-publish at that time. If someone ever
    // drops one of them, this test screams.
    const { fetcher, calls } = fakeFetch({ ok: true, body: { post_id: '1_3', id: 'photo' } })
    const when = new Date('2026-09-04T20:00:00Z')
    await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg',
      scheduledPublishTime: when, fetcher,
    })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.published).toBe(false)
    expect(body.scheduled_publish_time).toBe(Math.floor(when.getTime() / 1000))
  })

  it('post_id is preferred over the photo id — feed post vs photo object', async () => {
    const { fetcher } = fakeFetch({ ok: true, body: { post_id: 'PAGE_POST', id: 'PHOTO_OBJ' } })
    const r = await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg', fetcher,
    })
    expect(r.postId).toBe('PAGE_POST')
    expect(r.postIdSource).toBe('post_id')
  })

  it('immediate publish with post_id makes exactly one Graph call (no read-back)', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { post_id: `${PAGE}_1750835520181969`, id: '1750835520181969' } })
    const r = await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg', fetcher,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://graph.facebook.com/v20.0/${PAGE}/photos`)
    expect(r).toEqual({
      postId: `${PAGE}_1750835520181969`,
      postIdSource: 'post_id',
      permalink: `https://www.facebook.com/${PAGE}_1750835520181969`,
      raw: { post_id: `${PAGE}_1750835520181969`, id: '1750835520181969' },
    })
  })
})

describe('publishPagePhotoPost — scheduled photo returns only a photo id', () => {
  it('🔴 scheduled publish makes exactly one Graph call and keeps the photo id (no read-back at publish time)', async () => {
    // Meta: page_story_id "Applies only to published photos" — a scheduled photo
    // has none yet, so reading it back here would always fail. Resolution
    // happens later in the story-resolve workflow.
    const { fetcher, calls } = fakeFetch({ ok: true, body: { id: '1750835520181969' } })
    const r = await publishPagePhotoPost({
      pageId: PAGE, pageAccessToken: TOKEN,
      message: 'hi', imageUrl: 'https://x/img.jpg',
      scheduledPublishTime: new Date('2026-09-16T20:00:00Z'), fetcher,
    })
    expect(calls).toHaveLength(1)
    expect(r).toEqual({
      postId: '1750835520181969',
      postIdSource: 'id',
      permalink: 'https://www.facebook.com/1750835520181969',
      raw: { id: '1750835520181969' },
    })
  })

  it('throws when Meta returns an error — never retries silently', async () => {
    const { fetcher } = fakeFetch({
      ok: false, status: 400,
      body: { error: { message: '(#100) scheduled_publish_time must be at least 10 minutes in the future' } },
    })
    await expect(
      publishPagePhotoPost({
        pageId: PAGE, pageAccessToken: TOKEN,
        message: 'hi', imageUrl: 'https://x/img.jpg',
        scheduledPublishTime: new Date('2026-09-04T20:00:00Z'), fetcher,
      }),
    ).rejects.toThrow(/scheduled_publish_time/)
  })
})

describe('deletePagePost — idempotency and error surfacing', () => {
  it('fresh delete returns alreadyGone=false', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { success: true } })
    const r = await deletePagePost({ postId: 'p1', pageAccessToken: TOKEN, fetcher })
    expect(r.alreadyGone).toBe(false)
    expect(calls[0].init?.method).toBe('DELETE')
    expect(calls[0].url).toContain('/p1?')
    expect(calls[0].url).toContain('access_token=')
  })

  it('🔴 "object does not exist" (code 100) folds into alreadyGone=true, not an error', async () => {
    // A retried recall must not read as a failure just because the post is
    // already gone — that's exactly the state the caller wanted. Anything
    // else would make idempotent retries look broken.
    const { fetcher } = fakeFetch({
      ok: false, status: 400,
      body: { error: { message: 'Object with ID does not exist', code: 100 } },
    })
    const r = await deletePagePost({ postId: 'p_gone', pageAccessToken: TOKEN, fetcher })
    expect(r.alreadyGone).toBe(true)
  })

  it('throws on permission / transient errors so the batch decides', async () => {
    const { fetcher } = fakeFetch({
      ok: false, status: 400,
      body: { error: { message: '(#200) Requires pages_manage_posts', code: 200 } },
    })
    await expect(
      deletePagePost({ postId: 'p1', pageAccessToken: TOKEN, fetcher }),
    ).rejects.toThrow(/pages_manage_posts/)
  })

  it('scheduled-photo receipts: a bare photo id is deleted by that exact id (no rewrite to page_post)', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { success: true } })
    await deletePagePost({ postId: '1750835520181969', pageAccessToken: TOKEN, fetcher })
    expect(calls[0].init?.method).toBe('DELETE')
    expect(calls[0].url).toBe(`https://graph.facebook.com/v20.0/1750835520181969?access_token=${TOKEN}`)
  })

  it('url-encodes the post id — a raw underscore-heavy id must not break the request line', async () => {
    const { fetcher, calls } = fakeFetch({ ok: true, body: { success: true } })
    await deletePagePost({ postId: '1616575215312482_1750182373580617', pageAccessToken: TOKEN, fetcher })
    // encodeURIComponent leaves _ and digits alone, but this test locks the
    // fact that we encode at all — a future refactor cannot substitute a
    // string template that would break on ids containing `/` or `?`.
    expect(calls[0].url).toContain('1616575215312482_1750182373580617')
  })
})

/**
 * readPageStoryId — shapes follow Meta's Photo reference: a scheduled photo that
 * is not yet public answers `{id}` with no `page_story_id`; once public it
 * answers `page_story_id: "<page>_<photo>"`.
 */
describe('readPageStoryId — read-back after the photo is public', () => {
  const PHOTO = '1750835520181969'

  /** Real Response objects, one per call; records the url and init. */
  function graph(respond: (url: string, init?: RequestInit) => Promise<Response>) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return respond(String(input), init)
    }
    return { fetcher, calls }
  }
  const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

  it('🔴 public photo: returns the story id Graph gives, via GET ?fields=page_story_id with a timeout signal', async () => {
    const { fetcher, calls } = graph(json(200, { page_story_id: `${PAGE}_${PHOTO}`, id: PHOTO }))
    const r = await readPageStoryId({ photoId: PHOTO, pageId: PAGE, pageAccessToken: TOKEN, fetcher })

    expect(r).toEqual({ ok: true, postId: `${PAGE}_${PHOTO}` })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://graph.facebook.com/v20.0/${PHOTO}?fields=page_story_id&access_token=${TOKEN}`)
    expect(calls[0].init?.method ?? 'GET').toBe('GET')
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('🔴 returns what Graph says, not a composed pageId_photoId', async () => {
    const { fetcher } = graph(json(200, { page_story_id: `${PAGE}_99999999999` }))
    const r = await readPageStoryId({ photoId: PHOTO, pageId: PAGE, pageAccessToken: TOKEN, fetcher })
    expect(r).toEqual({ ok: true, postId: `${PAGE}_99999999999` })
  })

  it.each([
    ['scheduled, not yet public: {id} only', 200, { id: PHOTO }, 'no_page_story_id'],
    ['page_story_id is an empty string', 200, { id: PHOTO, page_story_id: '' }, 'no_page_story_id'],
    ['🔴 story id belongs to another Page', 200, { page_story_id: `999999999999_${PHOTO}` }, 'page_prefix_mismatch'],
    ['🔴 story id is not <page>_<digits>', 200, { page_story_id: `${PAGE}_abc` }, 'page_prefix_mismatch'],
    ['HTTP 200 but body carries an error', 200, { error: { message: 'boom', code: 2 } }, 'graph_error'],
    ['photo deleted (code 100 + subcode 33)', 400, { error: { message: 'does not exist', code: 100, error_subcode: 33 } }, 'object_not_found'],
    ['🔴 code 100 without subcode 33 is NOT "deleted"', 400, { error: { message: 'Invalid parameter', code: 100 } }, 'graph_error'],
    ['🔴 code 100 with another subcode is NOT "deleted"', 400, { error: { message: 'Unsupported get', code: 100, error_subcode: 2 } }, 'graph_error'],
    ['HTTP 500 without an error body', 500, 'nope', 'http_error'],
  ] as const)('%s → fixed reason code, no raw Graph text', async (_label, status, body, reason) => {
    const { fetcher } = graph(json(status, body))
    const r = await readPageStoryId({ photoId: PHOTO, pageId: PAGE, pageAccessToken: TOKEN, fetcher })
    expect(r).toEqual({ ok: false, reason })
  })

  it('network error → network_error, never throws', async () => {
    const { fetcher } = graph(async () => { throw new TypeError('fetch failed') })
    const r = await readPageStoryId({ photoId: PHOTO, pageId: PAGE, pageAccessToken: TOKEN, fetcher })
    expect(r).toEqual({ ok: false, reason: 'network_error' })
  })

  it('🔴 a hung Graph call is aborted by the timeout → timeout', async () => {
    // Fetcher that only settles when the signal aborts — exactly how real fetch behaves.
    const { fetcher } = graph((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    }))
    const r = await readPageStoryId({ photoId: PHOTO, pageId: PAGE, pageAccessToken: TOKEN, fetcher, timeoutMs: 20 })
    expect(r).toEqual({ ok: false, reason: 'timeout' })
  })
})
