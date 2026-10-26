import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { runFrozenFieldCheck } from '../frozen-ci'

function card(overrides: Record<string, string> = {}, body = '一行正文'): string {
  const fields = {
    id: '2026-09-28-test-card',
    title: '测试卡',
    status: 'decided',
    owner: 'agent',
    decided_on: '2026-09-28',
    source: 'session:a1b2c3d4',
    verify_by: '2026-10-05',
    verify_how: '跑一遍看看',
    ...overrides,
  }
  const yaml = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')
  return `---\n${yaml}\n---\n${body}\n`
}

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8' }).trim()
}

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-frozen-ci-'))
  git('git init', dir)
  git('git config user.email "test@test.com"', dir)
  git('git config user.name "Test"', dir)
  execSync('mkdir -p docs/ledger', { cwd: dir })
  return dir
}

describe('runFrozenFieldCheck（真实 git 仓库集成测试）', () => {
  let repoDir: string

  beforeAll(() => {
    repoDir = setupRepo()
  }, 60_000)

  afterAll(() => {
    execSync(`rm -rf "${repoDir}"`)
  })

  it('repairs invalid plain verification YAML without accepting a changed verification', () => {
    const dir = setupRepo()
    const path = join(dir, 'docs/ledger/2026-09-28-test-card.md')
    const value = "查 captureClientSnapshots(..., reason: 'kernel_post') 的调用方"
    writeFileSync(path, card({ verify_how: value }))
    git('git add -A && git commit -m "invalid old scalar"', dir)
    const base = git('git rev-parse HEAD', dir)
    writeFileSync(path, card({ verify_how: `|-\n  ${value}` }))
    git('git add -A && git commit -m "exact scalar wrapping"', dir)
    const repaired = git('git rev-parse HEAD', dir)
    expect(runFrozenFieldCheck(base, repaired, dir).errors).toEqual([])
    writeFileSync(path, card({ verify_how: `|-\n  ${value}改` }))
    git('git add -A && git commit -m "changed scalar"', dir)
    const changed = git('git rev-parse HEAD', dir)
    expect(runFrozenFieldCheck(base, changed, dir).errors.join('\n')).toContain('冻结字段 verify_how 被改写')
  })

  it('改写冻结字段 → error', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    writeFileSync(cardPath, card({ verify_how: '换了一种验法' }))
    git('git add -A && git commit -m "rewrite verify_how"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('verify_how')
    expect(result.errors[0]).toContain('被改写')

    execSync(`rm -rf "${dir}"`)
  })

  it('改名 → error（id 冻结所以改名即违规）', () => {
    const dir = setupRepo()
    const oldPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(oldPath, card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    const newPath = join(dir, 'docs/ledger/2026-09-28-renamed.md')
    git(`git mv "${oldPath}" "${newPath}"`, dir)
    writeFileSync(newPath, card({ id: '2026-09-28-renamed', verify_how: '新验法' }))
    git('git add -A && git commit -m "rename + rewrite"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('不许改名')

    execSync(`rm -rf "${dir}"`)
  })

  it('删除 decided 卡 → error', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card({ status: 'decided' }))
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    unlinkSync(cardPath)
    git('git add -A && git commit -m "delete decided card"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('不许删除')
    expect(result.errors[0]).toContain('decided')

    execSync(`rm -rf "${dir}"`)
  })

  it('删除 done 卡 → error', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card({
      status: 'done',
      done_on: '2026-09-28',
      done_ref: 'pr:100',
    }))
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    unlinkSync(cardPath)
    git('git add -A && git commit -m "delete done card"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('不许删除')
    expect(result.errors[0]).toContain('done')

    execSync(`rm -rf "${dir}"`)
  })

  it('删除 verified 卡 → warning（允许归档）', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card({
      status: 'verified',
      done_on: '2026-09-28',
      done_ref: 'pr:100',
      verified_ref: 'doc:docs/ledger/evidence/foo',
      last_checked: '2026-09-28',
    }))
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    unlinkSync(cardPath)
    git('git add -A && git commit -m "delete verified card"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('归档')

    execSync(`rm -rf "${dir}"`)
  })

  it('删除 failed 卡 → warning', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card({
      status: 'failed',
      done_on: '2026-09-28',
      done_ref: 'pr:100',
      verified_ref: 'doc:docs/ledger/evidence/foo',
      last_checked: '2026-09-28',
    }))
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    unlinkSync(cardPath)
    git('git add -A && git commit -m "delete failed card"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)

    execSync(`rm -rf "${dir}"`)
  })

  it('正常状态变更 → 通过', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    writeFileSync(cardPath, card({
      status: 'done',
      done_on: '2026-09-28',
      done_ref: 'pr:100',
    }))
    git('git add -A && git commit -m "mark done"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)

    execSync(`rm -rf "${dir}"`)
  })

  it('YAML 空格# 截断攻击 → error（raw 比对抓住）', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card({ verify_how: '查 PR #2010 结果' }))
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    writeFileSync(cardPath, card({ verify_how: '查 PR #9999 不用查了' }))
    git('git add -A && git commit -m "rewrite via yaml comment trick"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors.some((e) => e.includes('verify_how') && e.includes('被改写'))).toBe(true)

    execSync(`rm -rf "${dir}"`)
  })

  it('符号链接替换 → error', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-09-28-test-card.md')

    writeFileSync(cardPath, card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    unlinkSync(cardPath)
    writeFileSync(join(dir, 'somewhere-else.md'), card({ verify_how: '篡改后的验法' }))
    symlinkSync('../somewhere-else.md', cardPath)
    git('git add -A && git commit -m "replace with symlink"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors.some((e) => e.includes('符号链接'))).toBe(true)

    execSync(`rm -rf "${dir}"`)
  })

  it('新卡正文超 5 行 → error（即使 decided_on 写早）', () => {
    const dir = setupRepo()
    writeFileSync(join(dir, 'docs/ledger/2026-09-28-test-card.md'), card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    const longBody = Array.from({ length: 6 }, (_, i) => `第${i + 1}行内容`).join('\n')
    const newCardPath = join(dir, 'docs/ledger/2026-01-01-old-date.md')
    writeFileSync(newCardPath, card({
      id: '2026-01-01-old-date',
      decided_on: '2026-01-01',
    }, longBody))
    git('git add -A && git commit -m "add card with old date but long body"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors.some((e) => e.includes('新卡正文') && e.includes('超过上限'))).toBe(true)

    execSync(`rm -rf "${dir}"`)
  })

  it('新卡含未加引号的 空格# → error', () => {
    const dir = setupRepo()
    writeFileSync(join(dir, 'docs/ledger/2026-09-28-test-card.md'), card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    const newCardPath = join(dir, 'docs/ledger/2026-09-28-hash-card.md')
    writeFileSync(newCardPath, card({
      id: '2026-09-28-hash-card',
      verify_how: '查 PR #2010 结果',
    }))
    git('git add -A && git commit -m "add card with unquoted hash"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors.some((e) => e.includes('空格 #'))).toBe(true)

    execSync(`rm -rf "${dir}"`)
  })

  it('坏卡只改正编号和 PR # 写法 → 不报错', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-10-25-meta-client-token-db-verify.md')
    writeFileSync(cardPath, card({
      id: 'task_meta_client_token_db_verify',
      source: 'PR #3145',
      decided_on: '2026-10-25',
      verify_by: '2026-11-01',
    }))
    git('git add -A && git commit -m "broken card"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    writeFileSync(cardPath, card({
      id: '2026-10-25-meta-client-token-db-verify',
      source: 'pr:3145',
      decided_on: '2026-10-25',
      verify_by: '2026-11-01',
    }))
    git('git add -A && git commit -m "legal spelling"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.includes('主干版本解析失败'))).toBe(true)

    execSync(`rm -rf "${dir}"`)
  })

  it('坏卡顺手改验收说法 → 仍然报冻结字段', () => {
    const dir = setupRepo()
    const cardPath = join(dir, 'docs/ledger/2026-10-25-meta-client-token-db-verify.md')
    writeFileSync(cardPath, card({
      id: 'task_meta_client_token_db_verify',
      source: 'PR #3145',
      decided_on: '2026-10-25',
      verify_by: '2026-11-01',
    }))
    git('git add -A && git commit -m "broken card"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    writeFileSync(cardPath, card({
      id: '2026-10-25-meta-client-token-db-verify',
      source: 'pr:3145',
      decided_on: '2026-10-25',
      verify_by: '2026-11-01',
      verify_how: '换成别的验法',
    }))
    git('git add -A && git commit -m "changed verification"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors.some((e) => e.includes('verify_how') && e.includes('被改写'))).toBe(true)
    expect(result.errors.some((e) => e.includes('冻结字段 id'))).toBe(false)
    expect(result.errors.some((e) => e.includes('冻结字段 source'))).toBe(false)

    execSync(`rm -rf "${dir}"`)
  })

  it('没改过台账文件 → 通过', () => {
    const dir = setupRepo()
    writeFileSync(join(dir, 'docs/ledger/2026-09-28-test-card.md'), card())
    git('git add -A && git commit -m "base"', dir)
    const baseSha = git('git rev-parse HEAD', dir)

    writeFileSync(join(dir, 'README.md'), 'hello')
    git('git add -A && git commit -m "unrelated"', dir)
    const headSha = git('git rev-parse HEAD', dir)

    const result = runFrozenFieldCheck(baseSha, headSha, dir)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)

    execSync(`rm -rf "${dir}"`)
  })
})
