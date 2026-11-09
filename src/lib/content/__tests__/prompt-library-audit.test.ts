import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROMPT_LIBRARY_CHANGELOG,
  PROMPT_LIBRARY_DIR,
  auditPromptLibrary,
  extractCodeRefs,
  extractPendingFiles,
  refExists,
} from '../prompt-library-audit'

const roots: string[] = []

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'pl-'))
  roots.push(root)
  mkdirSync(join(root, PROMPT_LIBRARY_DIR), { recursive: true })
  mkdirSync(join(root, 'src/lib/x'), { recursive: true })
  return root
}

function writeLib(root: string, name: string, body: string): void {
  writeFileSync(join(root, PROMPT_LIBRARY_DIR, name), body, 'utf8')
}

function writeChangelog(root: string, body: string): void {
  writeFileSync(join(root, PROMPT_LIBRARY_DIR, PROMPT_LIBRARY_CHANGELOG), body, 'utf8')
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('extractCodeRefs', () => {
  it('finds a backticked path and strips ::FOO suffix and trailing )', () => {
    const md = 'see `src/lib/blog/generator.ts::FOO` and (src/lib/x/a.ts)'
    const refs = extractCodeRefs(md)
    expect(refs).toEqual([
      { line: 1, ref: 'src/lib/blog/generator.ts' },
      { line: 1, ref: 'src/lib/x/a.ts' },
    ])
  })
})

describe('refExists', () => {
  it('accepts a directory path and a path without extension when <ref>.ts exists', () => {
    const root = makeRepo()
    writeFileSync(join(root, 'src/lib/x/a.ts'), '', 'utf8')
    expect(refExists(root, 'src/lib/x')).toBe(true)
    expect(refExists(root, 'src/lib/x/a')).toBe(true)
    expect(refExists(root, 'src/lib/x/missing')).toBe(false)
  })
})

describe('extractPendingFiles', () => {
  it('returns names listed under a 待建文件 heading only', () => {
    const changelog = [
      '# 变更日志',
      '- `old.md` 已建',
      '## 待建文件',
      '- `foo.md` 计划中',
      '- `bar.md` 计划中',
      '## 其他',
      '- `baz.md` 不该出现',
    ].join('\n')
    expect(extractPendingFiles(changelog)).toEqual(['foo.md', 'bar.md'])
  })
})

describe('auditPromptLibrary', () => {
  it('reports a missing code path with the correct line number', () => {
    const root = makeRepo()
    writeLib(root, 'a.md', 'line one\nsee src/lib/x/missing.ts here\n')
    writeChangelog(root, 'a.md')
    const audit = auditPromptLibrary(root)
    expect(audit.error).toBeNull()
    expect(audit.findings).toEqual([
      {
        file: 'a.md',
        line: 2,
        reference: 'src/lib/x/missing.ts',
        reason: '文件里点名的代码路径在仓库里找不到',
      },
    ])
  })

  it('reports a file never mentioned in the changelog', () => {
    const root = makeRepo()
    writeLib(root, 'a.md', 'no refs here\n')
    writeChangelog(root, 'nothing relevant')
    const audit = auditPromptLibrary(root)
    expect(audit.findings).toEqual([
      {
        file: 'a.md',
        line: 0,
        reference: 'a.md',
        reason: '变更日志（CHANGELOG.md）从没记录过这个文件',
      },
    ])
  })

  it('reports a pending file listed in the changelog that does not exist', () => {
    const root = makeRepo()
    writeLib(root, 'a.md', 'no refs\n')
    writeChangelog(root, ['a.md', '## 待建文件', '- `foo.md` 计划中'].join('\n'))
    const audit = auditPromptLibrary(root)
    expect(audit.findings).toEqual([
      {
        file: PROMPT_LIBRARY_CHANGELOG,
        line: 0,
        reference: 'foo.md',
        reason: '变更日志说待建，文件还没建',
      },
    ])
  })

  it('returns no findings when everything is consistent', () => {
    const root = makeRepo()
    writeFileSync(join(root, 'src/lib/x/a.ts'), '', 'utf8')
    writeLib(root, 'a.md', 'see src/lib/x/a.ts\n')
    writeLib(root, 'b.md', 'nothing\n')
    writeChangelog(root, ['a.md', 'b.md'].join('\n'))
    const audit = auditPromptLibrary(root)
    expect(audit.error).toBeNull()
    expect(audit.findings).toEqual([])
    expect(audit.files_checked).toBe(2)
  })

  it('returns an error when the directory is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pl-'))
    roots.push(root)
    const audit = auditPromptLibrary(root)
    expect(audit.error).not.toBeNull()
    expect(audit.findings).toEqual([])
    expect(audit.files_checked).toBe(0)
  })

  it('returns 变更日志不存在 when the changelog is missing', () => {
    const root = makeRepo()
    writeLib(root, 'a.md', 'nothing\n')
    const audit = auditPromptLibrary(root)
    expect(audit.error).toBe('变更日志不存在')
    expect(audit.findings).toEqual([])
  })
})
