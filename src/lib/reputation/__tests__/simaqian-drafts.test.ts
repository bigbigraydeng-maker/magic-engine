import { describe, it, expect, vi } from 'vitest'
import {
  NEGATIVE_RATING_CEILING,
  PRAISE_RATING_FLOOR,
  MAX_REPLY_WORDS,
  excerpt,
  countNegative,
  buildReplySystemPrompt,
  buildReplyUserMessage,
  buildPraisePostPrompt,
  praiseCandidates,
  draftReplyFor,
  draftPraisePost,
  draftForClient,
  type NewReviewRow,
  type DraftLlm,
} from '../simaqian-drafts'

const BRAND = 'Fictional Cafe Co'

function fakeLlm(text = 'Thanks for your feedback.'): DraftLlm {
  return vi.fn(async () => ({
    text,
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0.001,
    stop_reason: 'end_turn',
  })) as unknown as DraftLlm
}

function review(over: Partial<NewReviewRow> = {}): NewReviewRow {
  return {
    review_uid: 'uid-1',
    author: 'Alex',
    rating: 5,
    text: 'Great coffee and friendly staff, will come back again soon for sure.',
    review_date: '2026-08-01',
    ...over,
  }
}

describe('buildReplySystemPrompt', () => {
  it('contains brand name, word limit, NEVER invent and AU/NZ', () => {
    const prompt = buildReplySystemPrompt(BRAND)
    expect(prompt).toContain(BRAND)
    expect(prompt).toContain(`${MAX_REPLY_WORDS} words`)
    expect(prompt).toContain('NEVER invent')
    expect(prompt).toContain('AU/NZ')
  })
})

describe('buildReplyUserMessage', () => {
  it('contains rating, author and text', () => {
    const msg = buildReplyUserMessage(review({ rating: 3, author: 'Sam', text: 'It was okay.' }))
    expect(msg).toContain('3')
    expect(msg).toContain('Sam')
    expect(msg).toContain('It was okay.')
  })
})

describe('countNegative', () => {
  it('counts rating <= 2 only and ignores null ratings', () => {
    const reviews = [
      review({ review_uid: 'a', rating: 1 }),
      review({ review_uid: 'b', rating: 2 }),
      review({ review_uid: 'c', rating: 3 }),
      review({ review_uid: 'd', rating: null }),
    ]
    expect(countNegative(reviews)).toBe(2)
    expect(NEGATIVE_RATING_CEILING).toBe(2)
  })
})

describe('praiseCandidates', () => {
  it('keeps rating >= 4 with >= 40 chars, max 2, drops short and 3-star', () => {
    const long = 'x'.repeat(60)
    const reviews = [
      review({ review_uid: 'a', rating: 5, text: long }),
      review({ review_uid: 'b', rating: 4, text: long }),
      review({ review_uid: 'c', rating: 5, text: long }),
      review({ review_uid: 'd', rating: 5, text: 'too short' }),
      review({ review_uid: 'e', rating: 3, text: long }),
    ]
    const picked = praiseCandidates(reviews)
    expect(picked).toHaveLength(2)
    expect(picked.map(r => r.review_uid)).toEqual(['a', 'b'])
    expect(PRAISE_RATING_FLOOR).toBe(4)
  })
})

describe('excerpt', () => {
  it('collapses whitespace and truncates with ellipsis', () => {
    expect(excerpt('  a   b  ')).toBe('a b')
    expect(excerpt('y'.repeat(200), 10)).toBe(`${'y'.repeat(10)}…`)
    expect(excerpt(null)).toBe('')
  })
})

describe('draftReplyFor', () => {
  it('returns a reason and does not call llm when review has no text', async () => {
    const llm = fakeLlm()
    const draft = await draftReplyFor(BRAND, review({ text: '   ' }), llm)
    expect(draft.reply_draft).toBeNull()
    expect(draft.reason).toBeTruthy()
    expect(llm).not.toHaveBeenCalled()
  })

  it('returns trimmed llm text and cost, calling with haiku + singleAttempt', async () => {
    const llm = fakeLlm('  Thanks so much!  ')
    const draft = await draftReplyFor(BRAND, review(), llm)
    expect(draft.reply_draft).toBe('Thanks so much!')
    expect(draft.cost_usd).toBe(0.001)
    expect(llm).toHaveBeenCalledTimes(1)
    const arg = (llm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.model).toBe('claude-haiku-4-5-20251001')
    expect(arg.singleAttempt).toBe(true)
  })

  it('does not throw and reports reason when llm throws', async () => {
    const llm = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as DraftLlm
    const draft = await draftReplyFor(BRAND, review(), llm)
    expect(draft.reply_draft).toBeNull()
    expect(draft.reason).toContain('起草失败')
  })
})

describe('draftPraisePost', () => {
  it('returns a reason and does not call llm when no candidates', async () => {
    const llm = fakeLlm()
    const result = await draftPraisePost(BRAND, [review({ rating: 3, text: 'meh' })], llm)
    expect(result.post_draft).toBeNull()
    expect(result.reason).toBeTruthy()
    expect(llm).not.toHaveBeenCalled()
  })
})

describe('draftForClient', () => {
  it('returns no_new_reviews and does not call llm when reviews are empty', async () => {
    const llm = fakeLlm()
    const receipt = await draftForClient(
      { clientId: 'c-1', clientName: BRAND, reviews: [] },
      llm,
    )
    expect(receipt.status).toBe('no_new_reviews')
    expect(receipt.replies).toEqual([])
    expect(receipt.post_draft).toBeNull()
    expect(receipt.cost_usd).toBe(0)
    expect(llm).not.toHaveBeenCalled()
  })

  it('drafts replies and a post for a mixed batch', async () => {
    const llm = fakeLlm('Thanks for reaching out.')
    const reviews = [
      review({ review_uid: 'neg', rating: 1, author: 'Jo', text: 'Cold food and slow service.' }),
      review({
        review_uid: 'pos',
        rating: 5,
        author: 'Kim',
        text: 'Absolutely loved the brunch here, the staff were wonderful and the coffee was perfect.',
      }),
    ]
    const receipt = await draftForClient(
      { clientId: 'c-2', clientName: BRAND, reviews },
      llm,
    )
    expect(receipt.status).toBe('drafted')
    expect(receipt.negative_reviews).toBe(1)
    expect(receipt.replies).toHaveLength(2)
    expect(receipt.post_draft).not.toBeNull()
    expect(receipt.cost_usd).toBeCloseTo(0.003, 10)
  })

  it('reports draft_failed with an error when every llm call throws', async () => {
    const llm = vi.fn(async () => {
      throw new Error('provider down')
    }) as unknown as DraftLlm
    const reviews = [
      review({ review_uid: 'neg', rating: 1, text: 'Cold food and slow service.' }),
      review({
        review_uid: 'pos',
        rating: 5,
        text: 'Absolutely loved the brunch here, the staff were wonderful and the coffee was perfect.',
      }),
    ]
    const receipt = await draftForClient(
      { clientId: 'c-3', clientName: BRAND, reviews },
      llm,
    )
    expect(receipt.status).toBe('draft_failed')
    expect(receipt.error).not.toBeNull()
  })
})
