/**
 * The 当场试跑 (trial-run) gate: which PRs owe a trial-run record, whether the
 * body carries one, and how that folds into the merge decision.
 *
 * Written against the ways it can fail badly:
 *  1. A PR that changes something scheduled getting through with no record —
 *     one test per path rule, so deleting a rule turns a test red.
 *  2. A placeholder or a template comment passing as a record.
 *  3. The check itself crashing, or ever producing `enable`.
 * And the ways it can over-block: test-only changes, deleted jobs, headings
 * with a note in brackets.
 */

import { describe, expect, it } from 'vitest'

import {
  CANNOT_RUN_MAX_DAYS,
  TRIAL_RUN_PATH_RULES,
  applyTrialRunToDecision,
  describeTrialRun,
  evaluateTrialRun,
  evaluateTrialRunSafely,
  planTrialRunReads,
  trialRunCheckFailed,
} from '../src/quality.mjs'
import {
  checkTrialRunElements,
  extractTrialRunSection,
  findCannotRunExit,
  parseLedgerVerifyBy,
  scheduledCodeInPatch,
  workflowHasSchedule,
} from '../src/trial-run.mjs'
import { shouldPostGateComment } from '../src/gate-marker.mjs'

const TODAY = '2026-09-27'
// Real files-API entries carry a `patch`; an entry without one is the
// "GitHub left the diff out" case, tested on its own below.
const PLAIN_PATCH = '@@ -1 +1 @@\n-const a = 1\n+const a = 2'
const mod = (filename: string, patch: string = PLAIN_PATCH) => ({ filename, status: 'modified', patch })
const added = (filename: string, patch: string = PLAIN_PATCH) => ({ filename, status: 'added', patch })

const RECORD = [
  '## 当场试跑',
  '- 触发方式：本机 `npx inngest-cli` 手动发事件 daily_plan.publish_queue.ready（dry_run）',
  '- 时间：2026-09-27 01:10 NZST',
  '- 状态：成功，处理 3 条，写回执 3 条',
].join('\n')

const evaluate = (files: unknown, body: unknown, contents: Record<string, string | null> = {}) =>
  evaluateTrialRun({ files, body, contents, today: TODAY })

describe('which changes owe a trial run', () => {
  it.each([
    ['render.yaml', '生产服务与 cron 调度'],
    ['src/app/api/cron/daily/route.ts', '生产定时任务路由'],
    ['src/lib/cron/registry.ts', '生产定时任务注册与调度'],
    ['src/lib/inngest/functions/daily-plan.ts', 'Inngest 后台 / 定时函数与注册'],
    ['src/lib/inngest/client.ts', 'Inngest 后台 / 定时函数与注册'],
    ['src/app/api/inngest/route.ts', 'Inngest 注册入口'],
    ['scripts/factory-worker/inngest-pilot.mjs', '工厂 worker 的 Inngest 函数'],
    ['src/lib/pm-todo/daily-todo.ts', '每天定时生成的今日待办'],
    ['scripts/auto-dev/run.mjs', '自动开发通道脚本'],
  ])('%s owes one (%s)', (path, why) => {
    const result = evaluate([mod(path)], '')
    expect(result.required).toBe(true)
    expect(result.satisfied).toBe(false)
    expect(result.hits.join('\n')).toContain(why)
  })

  it('a scheduled workflow owes one', () => {
    const wf = '.github/workflows/nightly.yml'
    const result = evaluate([mod(wf)], '', { [wf]: 'on:\n  schedule:\n    - cron: "0 5 * * *"\njobs: {}\n' })
    expect(result.required).toBe(true)
    expect(result.hits.join('\n')).toContain('带 schedule')
  })

  it('an unscheduled workflow does not', () => {
    const wf = '.github/workflows/ci.yml'
    expect(evaluate([mod(wf)], '', { [wf]: 'on:\n  pull_request:\njobs: {}\n' }).required).toBe(false)
  })

  it('a workflow whose content could not be read owes one — unknown is not "unscheduled"', () => {
    const wf = '.github/workflows/big.yml'
    expect(evaluate([mod(wf)], '', { [wf]: null }).required).toBe(true)
    expect(evaluate([mod(wf)], '', {}).required).toBe(true)
  })

  it('only top-level workflows count — GitHub ignores sub-directories', () => {
    const wf = '.github/workflows/templates/x.yml'
    expect(planTrialRunReads({ files: [mod(wf)] })).toEqual([])
    expect(evaluate([mod(wf)], '', { [wf]: 'on:\n  schedule: []\n' }).required).toBe(false)
  })

  it('ordinary business code does not owe one', () => {
    expect(evaluate([mod('src/lib/geo/score.ts'), mod('docs/a.md')], '')).toEqual({
      required: false,
      satisfied: true,
      via: null,
      hits: [],
      problems: [],
    })
  })

  it('every path rule is exercised above', () => {
    expect(TRIAL_RUN_PATH_RULES).toHaveLength(9)
  })
})

describe('changes that do not owe a trial run (子牙 design review)', () => {
  it.each([
    'src/lib/inngest/functions/__tests__/daily-plan.test.ts',
    'src/lib/inngest/functions/daily-plan.test.ts',
    'src/app/api/cron/daily/route.spec.ts',
    'src/lib/cron/__tests__/helpers.ts',
  ])('test-only file %s', (path) => {
    expect(evaluate([mod(path)], '').required).toBe(false)
  })

  it('deleting a scheduled job', () => {
    expect(evaluate([{ filename: 'src/app/api/cron/old/route.ts', status: 'removed' }], '').required).toBe(false)
  })

  it('but moving a job OUT of a scheduled path still owes one — the rename is not a deletion', () => {
    const renamed = { filename: 'src/lib/legacy/job.ts', previous_filename: 'src/lib/cron/job.ts', status: 'renamed' }
    expect(evaluate([renamed], '').required).toBe(true)
  })

  it('and moving a job INTO a scheduled path owes one', () => {
    const renamed = { filename: 'src/lib/inngest/functions/job.ts', previous_filename: 'src/lib/x/job.ts', status: 'renamed' }
    expect(evaluate([renamed], '').required).toBe(true)
  })
})

describe('fail closed on an unreadable diff', () => {
  it.each([[undefined], [[]], ['oops'], [[{ additions: 1 }]]])('files = %j owes a trial run', (files) => {
    expect(evaluate(files, '').required).toBe(true)
  })
})

describe('the record: 触发方式 / 时间 / 状态', () => {
  const files = [mod('src/lib/inngest/functions/daily-plan.ts')]

  it('passes with all three', () => {
    expect(evaluate(files, RECORD)).toMatchObject({ required: true, satisfied: true, via: 'record' })
  })

  it('fails with no section, and says so', () => {
    const result = evaluate(files, 'just a description')
    expect(result.satisfied).toBe(false)
    expect(result.problems).toEqual(['PR 正文没有「## 当场试跑」段'])
  })

  it.each([
    ['触发方式', RECORD.replace(/- 触发方式：.*\n/, '')],
    ['时间', RECORD.replace(/- 时间：.*\n/, '')],
    ['状态 / 退出码', RECORD.replace(/- 状态：.*$/, '')],
  ])('fails when %s is missing, and names it', (label, body) => {
    const result = evaluate(files, body)
    expect(result.satisfied).toBe(false)
    expect(result.problems.join('')).toContain(label)
  })

  it.each(['## 当场试跑（生产只读）', '## 当场试跑 (dry_run)', '##当场试跑', '## 当场试跑：本机'])(
    'accepts the heading %s',
    (heading) => {
      expect(evaluate(files, RECORD.replace('## 当场试跑', heading)).satisfied).toBe(true)
    },
  )

  it('does not accept a level-3 heading or a heading that merely contains the words', () => {
    expect(evaluate(files, RECORD.replace('## 当场试跑', '### 当场试跑')).satisfied).toBe(false)
    expect(evaluate(files, RECORD.replace('## 当场试跑', '## 关于当场试跑')).satisfied).toBe(false)
  })

  it('accepts bold labels, half-width colons, table rows, 退出码 and 运行状态', () => {
    const body = [
      '## 当场试跑',
      '| 项 | 值 |',
      '|---|---|',
      '| **触发方式** | 手动调用 /api/cron/daily?dry_run=1 |',
      '| 运行时间 | 2026-09-27 01:10 |',
      '- 退出码: 0',
    ].join('\n')
    expect(checkTrialRunElements(extractTrialRunSection(body) ?? []).missing).toEqual([])
    expect(evaluate(files, body).satisfied).toBe(true)
    expect(evaluate(files, RECORD.replace('- 状态：', '- 运行状态：')).satisfied).toBe(true)
  })

  it.each(['', 'TODO', '待填', '-', '…', '<时间>', 'xxx'])('rejects the placeholder value %j', (value) => {
    expect(evaluate(files, RECORD.replace(/(- 状态：).*$/, `$1${value}`)).satisfied).toBe(false)
  })

  it('rejects a time with no digit in it', () => {
    expect(evaluate(files, RECORD.replace(/(- 时间：).*\n/, '$1刚才\n')).satisfied).toBe(false)
  })

  it('ignores a filled-in record hidden inside an HTML comment (template text)', () => {
    const body = `## 当场试跑\n<!--\n${RECORD.split('\n').slice(1).join('\n')}\n-->`
    expect(evaluate(files, body).satisfied).toBe(false)
  })

  it('stops the section at the next level-1/2 heading', () => {
    const body = ['## 当场试跑', '- 触发方式：手动', '## 验证', '- 时间：2026-09-27', '- 状态：成功'].join('\n')
    expect(evaluate(files, body).satisfied).toBe(false)
  })

  it('keeps level-3 sub-headings inside the section', () => {
    const body = ['## 当场试跑', '### 第一次', '- 触发方式：手动', '- 时间：2026-09-27 01:00', '- 状态：成功'].join('\n')
    expect(evaluate(files, body).satisfied).toBe(true)
  })

  it('treats a non-string body as no section rather than throwing', () => {
    for (const body of [null, undefined, 42, { x: 1 }]) {
      expect(evaluate(files, body).satisfied).toBe(false)
    }
  })
})

describe('the "当场跑不了" exit (子牙 design review, item 1)', () => {
  const card = 'docs/ledger/2026-09-27-first-run-check.md'
  const cardText = (verifyBy: string) =>
    `---\nid: 2026-09-27-first-run-check\ntitle: x\nstatus: decided\nowner: agent\ndecided_on: 2026-09-27\nsource: pr:1\nverify_by: ${verifyBy}\nverify_how: y\n---\nbody\n`
  const exitBody = '## 当场试跑\n- 当场跑不了：要等明天早上 GSC 出数据才有输入\n- 台账卡：2026-09-27-first-run-check\n'
  const job = mod('src/lib/inngest/functions/weekly.ts')

  it('passes with a reason and a card this PR adds, due within 7 days', () => {
    const result = evaluate([job, added(card)], exitBody, { [card]: cardText('2026-09-28') })
    expect(result).toMatchObject({ satisfied: true, via: 'exit' })
  })

  it('accepts verify_by today and exactly 7 days out', () => {
    expect(evaluate([job, added(card)], exitBody, { [card]: cardText(TODAY) }).satisfied).toBe(true)
    expect(evaluate([job, added(card)], exitBody, { [card]: cardText('2026-10-04') }).satisfied).toBe(true)
    expect(CANNOT_RUN_MAX_DAYS).toBe(7)
  })

  it('fails when the card is only modified, not added by this PR', () => {
    const result = evaluate([job, mod(card)], exitBody, { [card]: cardText('2026-09-28') })
    expect(result.satisfied).toBe(false)
    expect(result.problems.join('')).toContain('本 PR 新增的台账卡')
  })

  it('fails when the section cites no card', () => {
    const body = '## 当场试跑\n- 当场跑不了：依赖明天的数据\n'
    expect(evaluate([job, added(card)], body, { [card]: cardText('2026-09-28') }).satisfied).toBe(false)
  })

  it('fails with an expired verify_by and says how to fix it', () => {
    const result = evaluate([job, added(card)], exitBody, { [card]: cardText('2026-09-26') })
    expect(result.satisfied).toBe(false)
    expect(result.problems.join('')).toContain('已过期，改成首次自动运行当天')
  })

  it('fails with a verify_by more than 7 days out', () => {
    const result = evaluate([job, added(card)], exitBody, { [card]: cardText('2026-10-05') })
    expect(result.satisfied).toBe(false)
    expect(result.problems.join('')).toContain('晚于 2026-10-04')
  })

  it('fails when the card cannot be read or has no valid verify_by', () => {
    expect(evaluate([job, added(card)], exitBody, { [card]: null }).satisfied).toBe(false)
    expect(evaluate([job, added(card)], exitBody, { [card]: cardText('2026-02-30') }).satisfied).toBe(false)
  })

  it('fails when the reason is a placeholder', () => {
    const body = exitBody.replace('要等明天早上 GSC 出数据才有输入', '待填')
    expect(evaluate([job, added(card)], body, { [card]: cardText('2026-09-28') }).satisfied).toBe(false)
  })

  it('fails when no valid date is supplied to judge verify_by against', () => {
    const result = evaluateTrialRun({ files: [job, added(card)], body: exitBody, contents: { [card]: cardText('2026-09-28') } })
    expect(result.satisfied).toBe(false)
  })

  it('asks the gate to read added ledger cards and changed workflows, nothing else', () => {
    expect(
      planTrialRunReads({
        files: [job, added(card), mod('docs/ledger/2026-01-01-old.md'), mod('.github/workflows/a.yml'), { filename: '.github/workflows/b.yml', status: 'removed' }],
      }),
    ).toEqual([card, '.github/workflows/a.yml'])
  })
})

describe('workflowHasSchedule — a narrow hand parser that fails towards "yes"', () => {
  it.each([
    ['block style', 'on:\n  schedule:\n    - cron: "0 5 * * *"\n  workflow_dispatch:\n'],
    ['quoted on key', '"on":\n  schedule:\n    - cron: "0 5 * * *"\n'],
    ['quoted schedule key', "on:\n  'schedule':\n    - cron: x\n"],
    ['flow style', 'on: { schedule: [{ cron: "0 5 * * *" }] }\n'],
    ['schedule after another trigger', 'on:\n  push:\n    branches: [main]\n  schedule:\n    - cron: x\n'],
  ])('%s → true', (_label, text) => {
    expect(workflowHasSchedule(text)).toBe(true)
  })

  it.each([
    ['no schedule', 'on:\n  pull_request:\n    types: [opened]\njobs:\n  a: {}\n'],
    ['schedule only in a comment', 'on:\n  # schedule:\n  #   - cron: x\n  pull_request:\n'],
    ['trailing comment mentioning schedule', 'on:\n  pull_request: # was schedule: before\n'],
    ['schedule inside a job script', 'on:\n  push:\njobs:\n  a:\n    steps:\n      - run: |\n          echo "schedule: nightly"\n'],
    ['schedule nested one level too deep', 'on:\n  workflow_dispatch:\n    inputs:\n      schedule:\n        type: string\n'],
    ['flow style without schedule', 'on: [push, pull_request]\n'],
    // Isolating probe: in block style a commented-out key never looks like a
    // key anyway, so dropping comment stripping survived the suite. These two
    // are the cases where only stripping keeps the answer right.
    ['flow style with schedule only in a trailing comment', 'on: [push, pull_request] # add schedule later\n'],
    ['column-0 comment inside the on block', 'on:\n# schedule:\n  push:\n'],
  ])('%s → false', (_label, text) => {
    expect(workflowHasSchedule(text)).toBe(false)
  })

  it.each([
    ['unreadable', null],
    ['not a string', 42],
    ['no on key', 'name: x\njobs: {}\n'],
    ['on is an alias', 'on: *triggers\n'],
    ['flow collection continued on the next line (DR78-4)', 'on: {\n  schedule: [{ cron: x }] }\n'],
    ['list flow continued on the next line', 'on: [push,\n  schedule]\n'],
    ['two on keys (DR78-4)', 'on:\n  push:\n"on":\n  schedule:\n    - cron: x\n'],
    ['merge key under on', 'on:\n  <<: *triggers\n'],
    ['empty on block', 'on:\njobs: {}\n'],
  ])('%s → null (caller treats as scheduled)', (_label, text) => {
    expect(workflowHasSchedule(text)).toBeNull()
  })
})

describe('small parsers', () => {
  it('extractTrialRunSection returns null when absent', () => {
    expect(extractTrialRunSection('## 验证\nx')).toBeNull()
  })

  it('findCannotRunExit collects every ledger id in the section', () => {
    const exit = findCannotRunExit(['- 当场跑不了：等数据', '- 卡：2026-09-27-a-b 和 2026-09-28-c'])
    expect(exit).toEqual({ reason: '等数据', cardIds: ['2026-09-27-a-b', '2026-09-28-c'] })
  })

  it('parseLedgerVerifyBy reads only the frontmatter', () => {
    expect(parseLedgerVerifyBy('---\nverify_by: 2026-10-01\n---\n')).toBe('2026-10-01')
    expect(parseLedgerVerifyBy('---\nid: x\n---\nverify_by: 2026-10-01\n')).toBeNull()
    expect(parseLedgerVerifyBy('no frontmatter')).toBeNull()
  })
})

describe('folding into the merge decision — stricter only, never enable', () => {
  const enable = { pass: true, decision: 'enable', tier: 'auto', reason: 'B 级：机器检查全绿后自动合并' }
  const signedA = {
    pass: true,
    decision: 'disable',
    tier: 'signed',
    reason: 'A 级：Codex Astra 与 Claude Code 两方签字齐，可由人合并（A 级永不自动合）',
  }
  const files = [mod('src/lib/inngest/functions/daily-plan.ts')]

  it('leaves the decision alone when no trial run is owed', () => {
    expect(applyTrialRunToDecision({ decision: enable, trialRun: evaluate([mod('src/x.ts')], '') })).toBe(enable)
  })

  it('leaves the decision alone when the record is there', () => {
    expect(applyTrialRunToDecision({ decision: enable, trialRun: evaluate(files, RECORD) })).toBe(enable)
  })

  it('blocks a B PR that owes a record and lacks one, with auto-merge off and a plain reason', () => {
    const result = applyTrialRunToDecision({ decision: enable, trialRun: evaluate(files, '') })
    expect(result).toEqual({
      pass: false,
      decision: 'disable',
      tier: 'blocked',
      reason: '当场试跑不合格 —— PR 正文没有「## 当场试跑」段',
    })
  })

  it('blocks a fully signed A PR too', () => {
    expect(applyTrialRunToDecision({ decision: signedA, trialRun: evaluate(files, '') }).pass).toBe(false)
  })

  it('blocks, with a reason, when the check itself failed (子牙 item 1 on PR2)', () => {
    const result = applyTrialRunToDecision({ decision: enable, trialRun: trialRunCheckFailed('GitHub API 502') })
    expect(result.decision).toBe('disable')
    expect(result.reason).toContain('试跑检查自身出错：GitHub API 502')
  })

  it.each([[undefined], [null], ['yes'], [{}], [{ required: true }], [{ required: 'false', satisfied: 'true' }]])(
    'blocks on a malformed trial-run result %j',
    (trialRun) => {
      const result = applyTrialRunToDecision({ decision: enable, trialRun })
      expect(result.decision).toBe('disable')
      expect(result.pass).toBe(false)
    },
  )

  it('never produces enable from any unsatisfied combination', () => {
    const decisions = [enable, signedA, { pass: false, decision: 'disable', tier: 'blocked', reason: 'x' }, undefined]
    const trialRuns = [
      evaluate(files, ''),
      evaluate(files, RECORD.replace(/- 时间：.*\n/, '')),
      trialRunCheckFailed('boom'),
      undefined,
      { required: true, satisfied: false, problems: [] },
    ]
    for (const decision of decisions) {
      for (const trialRun of trialRuns) {
        const result = applyTrialRunToDecision({ decision, trialRun })
        expect(result.decision).toBe('disable')
        expect(result.pass).toBe(false)
      }
    }
  })
})

describe('describeTrialRun — the summary says the machine does not verify truth', () => {
  const files = [mod('src/lib/inngest/functions/daily-plan.ts')]

  it('says 不涉及 when nothing is owed', () => {
    expect(describeTrialRun(evaluate([mod('src/x.ts')], ''))).toEqual(['- 当场试跑：不涉及（没改「以后会自动跑」的文件）'])
  })

  it('names the files, the problem and the fix when blocked', () => {
    const text = describeTrialRun(evaluate(files, '')).join('\n')
    expect(text).toContain('src/lib/inngest/functions/daily-plan.ts')
    expect(text).toContain('PR 正文没有「## 当场试跑」段')
    expect(text).toContain('补法')
    expect(text).toContain('机器只查段落在不在、格式对不对，试跑真假由审查人核对')
  })

  it('says the record is there, and still that truth is for reviewers', () => {
    const text = describeTrialRun(evaluate(files, RECORD)).join('\n')
    expect(text).toContain('段齐了')
    expect(text).toContain('试跑真假由审查人核对')
  })

  it('does not throw on garbage', () => {
    expect(describeTrialRun(undefined)[0]).toContain('读不到')
  })
})

// --- #2078 review round 1 (子牙 / 魏征 / 狄仁杰) ------------------------------

describe('DR78-1 / DR78-2: scheduled work added outside the path table is still caught', () => {
  it('a new createFunction( in an ordinary lib file owes a trial run', () => {
    const patch = '@@ -0,0 +1,3 @@\n+import { inngest } from "../inngest/client"\n+export const job = inngest.createFunction(\n+  { id: "x" },'
    const result = evaluate([mod('src/lib/growth/x.ts', patch)], '')
    expect(result.required).toBe(true)
    expect(result.hits.join('\n')).toContain('createFunction(')
  })

  // The real constants that set when these jobs run, as they stand on main.
  it.each([
    ['src/lib/ai-tracker/weekly-fanout.ts', "export const AI_VISIBILITY_WEEKLY_CRON = '0 6 * * 1'"],
    ['src/lib/competitors/watch.ts', "export const COMPETITOR_WATCH_CRON = '45 5 * * 1'"],
    ['src/lib/flywheel/seo-weekly.ts', "export const FLYWHEEL_SEO_WEEKLY_CRON = '15 5 * * 1'"],
    ['src/lib/seo-meta/cycle/roster.ts', "export const META_CYCLE_CRON = '30 5 * * 1'"],
  ])('changing the schedule constant in %s owes a trial run', (path, line) => {
    const patch = `@@ -1 +1 @@\n-${line.replace(/'[^']*'/, "'0 0 * * 1'")}\n+${line}`
    const result = evaluate([mod(path, patch)], '')
    expect(result.required).toBe(true)
    expect(result.hits.join('\n')).toContain('_CRON =')
  })

  it('a cron: key in an added line owes a trial run', () => {
    expect(evaluate([mod('src/lib/jobs/x.ts', '@@ -1 +1 @@\n+  { cron: "0 5 * * *" },')], '').required).toBe(true)
  })

  it('only ADDED lines count — removing a createFunction or the diff header does not', () => {
    const patch = '--- a/src/lib/x.ts\n+++ b/src/lib/x.ts createFunction(\n@@ -1,2 +1 @@\n-export const job = inngest.createFunction(\n const a = 1'
    expect(evaluate([mod('src/lib/x.ts', patch)], '').required).toBe(false)
  })

  it('does not scan documents or test files', () => {
    const patch = '@@ -0,0 +1 @@\n+createFunction( cron: X_CRON = 1'
    expect(evaluate([mod('docs/guide.md', patch)], '').required).toBe(false)
    expect(evaluate([mod('src/lib/x/__tests__/job.ts', patch)], '').required).toBe(false)
    expect(evaluate([mod('src/lib/x/job.test.ts', patch)], '').required).toBe(false)
  })

  it('a code file under src/ or scripts/ whose patch GitHub left out owes a trial run', () => {
    for (const path of ['src/lib/huge.ts', 'scripts/big-job.mjs']) {
      const result = evaluate([{ filename: path, status: 'modified', changes: 4000 }], '')
      expect(result.required, path).toBe(true)
      expect(result.hits.join('\n')).toContain('GitHub 没给出这份改动的内容')
    }
  })

  it('but a pure rename (zero changed lines, no patch) and files outside src/scripts do not', () => {
    const rename = { filename: 'src/lib/b.ts', previous_filename: 'src/lib/a.ts', status: 'renamed', changes: 0 }
    expect(evaluate([rename], '').required).toBe(false)
    expect(evaluate([{ filename: 'tools/x/y.mjs', status: 'modified', changes: 3 }], '').required).toBe(false)
  })

  it('scheduledCodeInPatch reports null for a missing patch, [] for a clean one', () => {
    expect(scheduledCodeInPatch(undefined)).toBeNull()
    expect(scheduledCodeInPatch('@@ -1 +1 @@\n+const a = 1')).toEqual([])
  })
})

describe('W78-1: a blocked decision keeps its own reason first', () => {
  const files = [mod('src/lib/inngest/functions/daily-plan.ts')]

  it.each([
    ['draft', { pass: false, decision: 'disable', tier: 'blocked', reason: '草稿 PR 不做合并判定' }],
    ['A without sign-off', { pass: false, decision: 'disable', tier: 'blocked', reason: 'A 级：缺签字 codex-astra/claude-code' }],
  ])('%s', (_label, decision) => {
    const result = applyTrialRunToDecision({ decision, trialRun: evaluate(files, '') })
    expect(result.reason).toBe(`${decision.reason}；另：当场试跑不合格 —— PR 正文没有「## 当场试跑」段`)
    expect(result.decision).toBe('disable')
  })

  it('a decision that was passing gets the trial-run reason alone', () => {
    const enable = { pass: true, decision: 'enable', tier: 'auto', reason: 'B 级：机器检查全绿后自动合并' }
    expect(applyTrialRunToDecision({ decision: enable, trialRun: evaluate(files, '') }).reason).toBe(
      '当场试跑不合格 —— PR 正文没有「## 当场试跑」段',
    )
  })
})

describe('DR78-3: an honest "did not run" or a loose label does not pass', () => {
  const files = [mod('src/lib/inngest/functions/daily-plan.ts')]

  it.each(['n/a', 'N/A', '?', '？', '未跑', '没跑', '未运行', '0'])('状态：%s is not an answer', (value) => {
    expect(evaluate(files, RECORD.replace(/(- 状态：).*$/, `$1${value}`)).satisfied).toBe(false)
  })

  it('but 退出码：0 is a real answer', () => {
    expect(evaluate(files, RECORD.replace(/- 状态：.*$/, '- 退出码：0')).satisfied).toBe(true)
  })

  // One label swapped at a time, so each case isolates exactly one whitelist.
  it.each([
    ['时间', '预计时间'],
    ['时间', '计划时间'],
    ['状态', '未跑状态'],
    ['状态', '期望状态'],
  ])('%s label replaced by %s is not on the whitelist', (original, label) => {
    const body = RECORD.replace(`- ${original}：`, `- ${label}：`)
    expect(evaluate(files, body).satisfied).toBe(false)
  })

  it.each(['2026年', 'today 3pm', '上周', '第 3 次'])('time %j names no checkable moment', (value) => {
    expect(evaluate(files, RECORD.replace(/(- 时间：).*\n/, `$1${value}\n`)).satisfied).toBe(false)
  })

  it.each(['2026-09-27', '9/27', '9月27日', '01:10'])('time %j is checkable', (value) => {
    expect(evaluate(files, RECORD.replace(/(- 时间：).*\n/, `$1${value}\n`)).satisfied).toBe(true)
  })
})

describe('the summary states the design boundary', () => {
  it('says it does not follow the code a job calls', () => {
    const text = describeTrialRun(evaluate([mod('src/lib/cron/x.ts')], '')).join('\n')
    expect(text).toContain('不追踪它们调用的代码')
  })
})

describe('W78-5: evaluateTrialRunSafely never throws', () => {
  const files = [mod('src/lib/inngest/functions/daily-plan.ts')]

  it('passes a good record through', async () => {
    const result = await evaluateTrialRunSafely({ files, body: RECORD, today: TODAY, readFiles: async () => ({}) })
    expect(result.satisfied).toBe(true)
  })

  it('turns a failing reader into a blocking result with the error', async () => {
    const result = await evaluateTrialRunSafely({
      files,
      body: RECORD,
      today: TODAY,
      readFiles: async () => {
        throw new Error('GitHub API 502')
      },
    })
    expect(result).toMatchObject({ required: true, satisfied: false })
    expect(result.problems[0]).toBe('试跑检查自身出错：GitHub API 502')
    expect(applyTrialRunToDecision({ decision: { pass: true, decision: 'enable', tier: 'auto' }, trialRun: result }).decision).toBe('disable')
  })

  it('blocks when no reader is supplied', async () => {
    const result = await evaluateTrialRunSafely({ files, body: RECORD, today: TODAY })
    expect(result.satisfied).toBe(false)
    expect(result.problems[0]).toContain('试跑检查自身出错')
  })

  it('survives a malformed file list that throws on access', async () => {
    const hostile = [
      {
        get filename(): string {
          throw new Error('boom')
        },
      },
    ]
    const result = await evaluateTrialRunSafely({ files: hostile, body: '', today: TODAY, readFiles: async () => ({}) })
    expect(result.satisfied).toBe(false)
    expect(result.problems[0]).toContain('boom')
  })
})

describe('W78-2: the rating comment is re-posted when the decision flips', () => {
  const on = (risk: string, decision?: string) => ({ v: 1, base: 'b', head: 'h', risk, reasons: [], decision })

  it('posts when nothing is on record', () => {
    expect(shouldPostGateComment({ existing: null, risk: 'B', decision: 'disable' })).toBe(true)
  })

  it('posts when the 当场试跑 section was filled in and the decision went disable → enable', () => {
    expect(shouldPostGateComment({ existing: on('B', 'disable'), risk: 'B', decision: 'enable' })).toBe(true)
  })

  it('posts when the risk changed', () => {
    expect(shouldPostGateComment({ existing: on('B', 'disable'), risk: 'A', decision: 'disable' })).toBe(true)
  })

  it('posts once for an old marker that predates the decision field', () => {
    expect(shouldPostGateComment({ existing: on('B'), risk: 'B', decision: 'disable' })).toBe(true)
  })

  it('stays quiet when nothing changed', () => {
    expect(shouldPostGateComment({ existing: on('B', 'enable'), risk: 'B', decision: 'enable' })).toBe(false)
  })
})
