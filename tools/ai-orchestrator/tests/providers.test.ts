import { describe, expect, it, vi } from 'vitest'

import {
  ANTHROPIC_API_KEY_SECRET,
  NEVER_ALLOWED_TOOLS,
  createClaudeImplementer,
} from '../src/adapters/claude/implementer'
import { OPENAI_API_KEY_SECRET, createOpenAIReviewer } from '../src/adapters/openai/reviewer'
import { RestGitHubClient, createRestGitHubClient } from '../src/adapters/github/rest-client'
import {
  LedgerWriteBlockedError,
  MissingSecretError,
  ProviderDisabledError,
  ProviderNotWiredError,
} from '../src/domain/errors'
import { SCAFFOLD_DISALLOWED_TOOLS } from '../src/config/scaffold-config'

const REPO = { owner: 'bigbigraydeng-maker', repo: 'magic-engine' }

describe('fail closed on missing secrets', () => {
  it('refuses to build the reviewer without an API key', () => {
    const result = createOpenAIReviewer({ enabled: true, apiKey: undefined })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBeInstanceOf(MissingSecretError)
    expect(result.ok === false && result.error.message).toContain(OPENAI_API_KEY_SECRET)
  })

  it('refuses to build the implementer without an API key', () => {
    const result = createClaudeImplementer({ enabled: true, apiKey: '' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBeInstanceOf(MissingSecretError)
    expect(result.ok === false && result.error.message).toContain(ANTHROPIC_API_KEY_SECRET)
  })

  it('refuses to build the GitHub client without a token', () => {
    const result = createRestGitHubClient({ token: undefined, repository: REPO })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBeInstanceOf(MissingSecretError)
  })
})

describe('disabled providers are never callable', () => {
  it('checks disabled before it checks the key, so a present key does not help', () => {
    const result = createOpenAIReviewer({ enabled: false, apiKey: 'sk-live-should-not-matter' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBeInstanceOf(ProviderDisabledError)
  })

  it('does the same for the implementer', () => {
    const result = createClaudeImplementer({ enabled: false, apiKey: 'sk-ant-should-not-matter' })
    expect(result.ok === false && result.error).toBeInstanceOf(ProviderDisabledError)
  })
})

describe('real adapters are skeletons in v0.1', () => {
  it('builds with a key but refuses to call the model', async () => {
    const result = createOpenAIReviewer({ enabled: true, apiKey: 'sk-test-not-real' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await expect(
      result.provider.review({
        run_id: 'r',
        round: 1,
        system: 's',
        user: 'u',
        untrusted_sources: [],
        idempotency_key: 'k',
        input_digest: 'd',
        timeout_ms: 1000,
        signal: new AbortController().signal,
        max_output_tokens: 100,
        reserved_cost_usd: 0.5,
        cost_estimate: {
          max_cost_usd: 0.5,
          model: 'm',
          pricing_version: 'test',
          input_tokens_estimate: 10,
          max_output_tokens: 100,
          breakdown: {},
        },
      })
    ).rejects.toBeInstanceOf(ProviderNotWiredError)
  })

  it('does the same for the implementer', async () => {
    const result = createClaudeImplementer({ enabled: true, apiKey: 'sk-ant-test-not-real' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await expect(
      result.provider.implement({
        run_id: 'r',
        round: 1,
        system: 's',
        user: 'u',
        untrusted_sources: [],
        idempotency_key: 'k',
        input_digest: 'd',
        timeout_ms: 1000,
        signal: new AbortController().signal,
        max_output_tokens: 100,
        reserved_cost_usd: 0.5,
        cost_estimate: {
          max_cost_usd: 0.5,
          model: 'm',
          pricing_version: 'test',
          input_tokens_estimate: 10,
          max_output_tokens: 100,
          breakdown: {},
        },
      })
    ).rejects.toBeInstanceOf(ProviderNotWiredError)
  })

  it('keeps merge and force-push on the never-allowed list', () => {
    expect(NEVER_ALLOWED_TOOLS).toContain('Bash(gh pr merge*)')
    expect(SCAFFOLD_DISALLOWED_TOOLS).toContain('Bash(gh pr merge*)')
    expect(SCAFFOLD_DISALLOWED_TOOLS).toContain('Bash(git push --force*)')
  })
})

describe('RestGitHubClient write guard', () => {
  it('is read-only by default and never issues the request', async () => {
    const fetchImpl = vi.fn()
    const client = new RestGitHubClient({ token: 'ghp_test', repository: REPO, fetchImpl: fetchImpl as unknown as typeof fetch })

    await expect(client.createIssueComment(860, 'hello')).rejects.toBeInstanceOf(
      LedgerWriteBlockedError
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads through the injected fetch rather than the global one', async () => {
    // Two calls: the issue pre-fetch that supplies the completeness floor, then
    // the label page itself.
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (/\/issues\/\d+$/.test(new URL(href).pathname)) {
        return new Response(JSON.stringify({ comments: 0, labels: [{ name: 'enhancement' }] }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify([{ name: 'enhancement' }]), { status: 200 })
    })
    const client = new RestGitHubClient({
      token: 'ghp_test',
      repository: REPO,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.listIssueLabels(860)).resolves.toEqual(['enhancement'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
