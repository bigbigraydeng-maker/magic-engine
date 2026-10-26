/**
 * The ruleset reads "Risk gate" on the PR head. Comment-triggered runs do not
 * land there, so the verdict is a check run we create ourselves.
 */
import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { buildRiskGateCheckRun, gateJobExitCode, planAutoMergeEnable, shouldPublishHeadCheck } from '../src/head-check.mjs'

const HEAD = 'b8ae3e8b6015974044d3aff0c0a525d09368c9a1'
const NEWER_HEAD = 'e4771192c05a734212740f76da336d273340e7fb'
const NOW = '2026-10-24T12:20:10.000Z'

describe('shouldPublishHeadCheck', () => {
  it('publishes for comment runs and any other non-pull-request event', () => {
    expect(shouldPublishHeadCheck('issue_comment')).toBe(true)
    expect(shouldPublishHeadCheck('workflow_dispatch')).toBe(true)
  })

  it('does not publish when the job itself is already the head check', () => {
    expect(shouldPublishHeadCheck('pull_request_target')).toBe(false)
    expect(shouldPublishHeadCheck('pull_request')).toBe(false)
  })

  it('fails closed on a missing event instead of exiting the head-bound job green', () => {
    expect(shouldPublishHeadCheck('')).toBe(false)
    expect(shouldPublishHeadCheck(undefined)).toBe(false)
  })
})

describe('gateJobExitCode', () => {
  it('keeps the pull_request_target job red until the gate passes', () => {
    expect(gateJobExitCode({ eventName: 'pull_request_target', pass: false, headCheckPublished: false })).toBe(1)
    expect(gateJobExitCode({ eventName: 'pull_request_target', pass: true, headCheckPublished: false })).toBe(0)
  })

  it('exits 0 after a comment run records a failure, so the default branch is not painted red', () => {
    expect(gateJobExitCode({ eventName: 'issue_comment', pass: false, headCheckPublished: true })).toBe(0)
    expect(gateJobExitCode({ eventName: 'issue_comment', pass: true, headCheckPublished: true })).toBe(0)
  })

  it('exits 1 when a comment run could not record the head check', () => {
    expect(gateJobExitCode({ eventName: 'issue_comment', pass: true, headCheckPublished: false })).toBe(1)
  })

  it('does not treat an unknown event as a successful republish', () => {
    expect(gateJobExitCode({ eventName: '', pass: false, headCheckPublished: true })).toBe(1)
  })

  it('草稿 PR 不挂红叉；但只认明确的 true，缺失或写歪都仍然红（失败朝严）', () => {
    expect(gateJobExitCode({ eventName: 'pull_request_target', pass: false, draft: true })).toBe(0)
    for (const draft of [false, undefined, null, 'true', 1]) {
      expect(gateJobExitCode({ eventName: 'pull_request_target', pass: false, draft }), String(draft)).toBe(1)
    }
    expect(gateJobExitCode({ eventName: 'issue_comment', pass: false, headCheckPublished: false, draft: true })).toBe(1)
  })
})

describe('buildRiskGateCheckRun · draft', () => {
  it('草稿未通过 → neutral；非草稿未通过仍是 failure；通过永远是 success', () => {
    const base = { headSha: HEAD, summary: 's', now: NOW }
    expect(buildRiskGateCheckRun({ ...base, pass: false, draft: true }).conclusion).toBe('neutral')
    expect(buildRiskGateCheckRun({ ...base, pass: false, draft: false }).conclusion).toBe('failure')
    expect(buildRiskGateCheckRun({ ...base, pass: false, draft: undefined }).conclusion).toBe('failure')
    expect(buildRiskGateCheckRun({ ...base, pass: false, draft: 'true' }).conclusion).toBe('failure')
    expect(buildRiskGateCheckRun({ ...base, pass: true, draft: true }).conclusion).toBe('success')
  })
})

describe('buildRiskGateCheckRun', () => {
  it('writes a success named Risk gate onto the PR head after a clean review', () => {
    const body = buildRiskGateCheckRun({ headSha: HEAD, pass: true, summary: '已审过', now: NOW })
    expect(body.name).toBe('Risk gate')
    expect(body.head_sha).toBe(HEAD)
    expect(body.status).toBe('completed')
    expect(body.conclusion).toBe('success')
    expect(body.output.summary).toBe('已审过')
  })

  it('writes a failure onto the same head when the head is still unreviewed', () => {
    const body = buildRiskGateCheckRun({ headSha: HEAD, pass: false, summary: '还没审', now: NOW })
    expect(body.conclusion).toBe('failure')
    expect(body.head_sha).toBe(HEAD)
  })

  it('refuses a short or empty sha, so a result cannot land on the default branch by mistake', () => {
    expect(() => buildRiskGateCheckRun({ headSha: 'a454ef4', pass: true, summary: 'x', now: NOW })).toThrow(/full head sha/)
    expect(() => buildRiskGateCheckRun({ headSha: '', pass: false, summary: 'x', now: NOW })).toThrow(/full head sha/)
  })

  it('caps the summary and attaches a details url only when one was given', () => {
    const body = buildRiskGateCheckRun({ headSha: HEAD, pass: false, summary: 'y'.repeat(70_000), now: NOW })
    expect(body.output.summary.length).toBe(65_000)
    expect(body.details_url).toBeUndefined()
    const linked = buildRiskGateCheckRun({
      headSha: HEAD,
      pass: true,
      summary: 'ok',
      now: NOW,
      detailsUrl: 'https://github.com/example/repo/actions/runs/1',
    })
    expect(linked.details_url).toBe('https://github.com/example/repo/actions/runs/1')
  })
})

describe('planAutoMergeEnable', () => {
  it('enables only while the live head is still the reviewed sha, and pins that sha', () => {
    const plan = planAutoMergeEnable({ boundHead: HEAD, liveHead: HEAD })
    expect(plan.enable).toBe(true)
    expect(plan.args).toEqual(['pr', 'merge', '--auto', '--merge', '--match-head-commit', HEAD])
  })

  it('does not re-enable after a newer push, even when the re-check already decided enable', () => {
    const plan = planAutoMergeEnable({ boundHead: HEAD, liveHead: NEWER_HEAD })
    expect(plan.enable).toBe(false)
    expect(plan.args).toEqual([])
  })

  it('refuses a short, empty, or missing sha', () => {
    expect(planAutoMergeEnable({ boundHead: 'e4771192', liveHead: 'e4771192' }).enable).toBe(false)
    expect(planAutoMergeEnable({ boundHead: HEAD, liveHead: '' }).enable).toBe(false)
    expect(planAutoMergeEnable({ boundHead: '', liveHead: HEAD }).enable).toBe(false)
    expect(planAutoMergeEnable({}).enable).toBe(false)
  })

  it('the workflow entry prints skip for a stale head and enable only for the same head', () => {
    const script = 'tools/ops-review-loop/src/head-check.mjs'
    const run = (liveHead: string) =>
      execFileSync(process.execPath, [script, '--plan-auto-merge'], {
        env: { ...process.env, HEAD_SHA: HEAD, LIVE_HEAD: liveHead },
        encoding: 'utf8',
      }).trim()
    expect(run(NEWER_HEAD)).toBe('skip')
    expect(run(HEAD)).toBe('enable')
  })
})
