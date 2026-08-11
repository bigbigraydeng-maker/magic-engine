import { describe, expect, it } from 'vitest'
import { decide, type CommentLike } from '../src/decide'
import { buildMarker } from '../src/marker'
import { DEFAULT_CONFIG } from '../src/config'

function comment(overrides: Partial<CommentLike> & { id: number }): CommentLike {
  return {
    body: '',
    login: 'someone',
    userType: 'User',
    authorAssociation: 'NONE',
    ...overrides,
  }
}

const claudeComment = (id: number, body = 'substantive discussion reply'): CommentLike =>
  comment({ id, body, login: 'claude[bot]', userType: 'Bot', authorAssociation: 'NONE' })

const ownerRelayComment = (id: number): CommentLike =>
  comment({
    id,
    body: 'please continue /relay-codex',
    login: 'bigbigraydeng-maker',
    userType: 'User',
    authorAssociation: 'OWNER',
  })

describe('decide — trust guards', () => {
  it('relays a Claude bot comment with no history', () => {
    const result = decide(claudeComment(1), [], DEFAULT_CONFIG)
    expect(result).toEqual({ kind: 'relay', round: 1, sourceCommentId: 1 })
  })

  it('relays a repository-owner comment that explicitly requests a relay', () => {
    const result = decide(ownerRelayComment(1), [], DEFAULT_CONFIG)
    expect(result).toEqual({ kind: 'relay', round: 1, sourceCommentId: 1 })
  })

  it('skips a repository-owner comment that does not contain the relay phrase', () => {
    const trigger = comment({
      id: 1,
      body: 'just a normal comment',
      login: 'bigbigraydeng-maker',
      userType: 'User',
      authorAssociation: 'OWNER',
    })
    expect(decide(trigger, [], DEFAULT_CONFIG)).toEqual({ kind: 'skip', reason: 'untrusted_actor' })
  })

  it('skips a comment from a random user, even one that types the relay phrase', () => {
    const trigger = comment({
      id: 1,
      body: '/relay-codex',
      login: 'random-passerby',
      userType: 'User',
      authorAssociation: 'NONE',
    })
    expect(decide(trigger, [], DEFAULT_CONFIG)).toEqual({ kind: 'skip', reason: 'untrusted_actor' })
  })

  it('skips a bot comment whose login is not on the trusted list, even if it claims to be Claude', () => {
    const trigger = comment({ id: 1, login: 'not-claude[bot]', userType: 'Bot', authorAssociation: 'NONE' })
    expect(decide(trigger, [], DEFAULT_CONFIG)).toEqual({ kind: 'skip', reason: 'untrusted_actor' })
  })

  it('skips a comment authored by the workflow bot identity itself', () => {
    const trigger = comment({
      id: 1,
      login: DEFAULT_CONFIG.workflowBotLogin,
      userType: 'Bot',
      authorAssociation: 'NONE',
      body: buildMarker({ round: 1, sourceCommentId: 999 }),
    })
    expect(decide(trigger, [], DEFAULT_CONFIG)).toEqual({ kind: 'skip', reason: 'own_comment' })
  })
})

describe('decide — dedup by comment id', () => {
  it('skips a trigger whose comment id already has a relay marker in history', () => {
    const trigger = claudeComment(5)
    const history = [
      comment({
        id: 6,
        login: DEFAULT_CONFIG.workflowBotLogin,
        body: buildMarker({ round: 1, sourceCommentId: 5 }),
      }),
    ]
    expect(decide(trigger, history, DEFAULT_CONFIG)).toEqual({ kind: 'skip', reason: 'duplicate_comment' })
  })

  it('does not treat a different source comment id as a duplicate', () => {
    const trigger = claudeComment(7)
    const history = [
      comment({
        id: 6,
        login: DEFAULT_CONFIG.workflowBotLogin,
        body: buildMarker({ round: 1, sourceCommentId: 5 }),
      }),
    ]
    expect(decide(trigger, history, DEFAULT_CONFIG)).toEqual({ kind: 'relay', round: 2, sourceCommentId: 7 })
  })
})

describe('decide — round counting and the 4-round cap', () => {
  it('advances to the next round based on the highest round marker seen', () => {
    const trigger = claudeComment(10)
    const history = [
      comment({ id: 2, login: DEFAULT_CONFIG.workflowBotLogin, body: buildMarker({ round: 1, sourceCommentId: 1 }) }),
      comment({ id: 4, login: DEFAULT_CONFIG.workflowBotLogin, body: buildMarker({ round: 2, sourceCommentId: 3 }) }),
    ]
    expect(decide(trigger, history, DEFAULT_CONFIG)).toEqual({ kind: 'relay', round: 3, sourceCommentId: 10 })
  })

  it('relays exactly through round 4', () => {
    const trigger = claudeComment(10)
    const history = [1, 2, 3].map((round) =>
      comment({
        id: round * 2,
        login: DEFAULT_CONFIG.workflowBotLogin,
        body: buildMarker({ round, sourceCommentId: round }),
      })
    )
    expect(decide(trigger, history, DEFAULT_CONFIG)).toEqual({ kind: 'relay', round: 4, sourceCommentId: 10 })
  })

  it('halts instead of starting a 5th round', () => {
    const trigger = claudeComment(10)
    const history = [1, 2, 3, 4].map((round) =>
      comment({
        id: round * 2,
        login: DEFAULT_CONFIG.workflowBotLogin,
        body: buildMarker({ round, sourceCommentId: round }),
      })
    )
    expect(decide(trigger, history, DEFAULT_CONFIG)).toEqual({ kind: 'halt', sourceCommentId: 10 })
  })

  it('skips further triggers once a halt marker exists, rather than halting again', () => {
    const trigger = claudeComment(20)
    const history = [
      comment({ id: 2, login: DEFAULT_CONFIG.workflowBotLogin, body: buildMarker({ round: 4, sourceCommentId: 1 }) }),
      comment({
        id: 3,
        login: DEFAULT_CONFIG.workflowBotLogin,
        body: buildMarker({ round: 'halt', sourceCommentId: 19 }),
      }),
    ]
    expect(decide(trigger, history, DEFAULT_CONFIG)).toEqual({ kind: 'skip', reason: 'already_halted' })
  })
})
