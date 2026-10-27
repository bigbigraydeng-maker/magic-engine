import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCatalog, readAllowedDoc } from '../load'
import { parseReadme } from '../parse-readme'
import { parseDocHeader } from '../header'
import { resolveDocLink } from '../links'
import { isGlobalAdmin } from '../guard'

const dirs: string[] = []
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-docs-'))
  dirs.push(root)
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return root
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const README = ["# 名单","","| 中文名 | 代号 | 分组 | 状态 | 档案 | 手册 |","|---|---|---|---|---|---|","| 示例甲 | alpha | §4.1 | 在用 | [档案](10-alpha.md) | [规则](../sops/alpha-rules.md) |","| 示例乙 | beta | §4.2 | 已撤 | 80-beta.md | |","| 示例丙 | gamma | §4.3 | 名单外，待 PM 定 | | |","| 坏行 |","","## 手册归属","","| 手册 | 归属 |","|---|---|","| \\`docs/sops/shared.md\\` | 示例乙 |","| \\`docs/clients/secret-client.md\\` | 示例甲 |",""].join('\n')

describe('parseReadme', () => {
  it('reads both tables and counts malformed rows', () => {
    const p = parseReadme(README)
    expect(p.agents.map((a) => a.nameZh)).toEqual(['示例甲', '示例乙', '示例丙'])
    expect(p.agents[1].status).toBe('retired')
    expect(p.agents[2].status).toBe('outside')
    expect(p.ownership).toHaveLength(2)
    expect(p.skippedLines).toBe(1)
  })
  it('never throws on garbage', () => {
    expect(parseReadme('|||\n| - |\nrandom').agents).toEqual([])
  })
})

describe('buildCatalog', () => {
  it('README is the source of truth; unknown folders are not whitelisted', () => {
    const root = repo({
      'docs/agents/README.md': README, 'docs/agents/10-alpha.md': '# 示例甲 — 手册',
      'docs/sops/alpha-rules.md': '# r', 'docs/sops/shared.md': '# s', 'docs/clients/secret-client.md': '# secret',
    })
    const c = buildCatalog(root)
    const alpha = c.rows.find((r) => r.code === 'alpha')!
    expect(alpha.playbooks.map((p) => p.file)).toEqual(['alpha-rules.md'])
    expect(c.rows.find((r) => r.code === 'beta')!.playbooks.map((p) => p.file)).toEqual(['shared.md'])
    expect(c.allowed.has('sops/shared.md')).toBe(true)
    expect([...c.allowed].some((k) => k.includes('secret-client'))).toBe(false)
    expect(c.notes.some((n) => n.includes('secret-client'))).toBe(true)
    expect(c.readmeMissing).toBe(false)
  })
  it('falls back to profiles when README is missing and flags it', () => {
    const root = repo({
      'docs/agents/10-ziya.md': '# 子牙 — Agent 手册\n\n## 九、操作手册\n\n- [规则](../sops/a.md)\n\n## 十、其他\n',
      'docs/agents/80-davinci.md': '# 达芬奇\n> 已撤 2026-09-24\n',
      'docs/agents/00-architecture.md': '# 架构', 'docs/sops/a.md': '# a',
    })
    const c = buildCatalog(root)
    expect(c.readmeMissing).toBe(true)
    expect(c.rows.map((r) => r.nameZh)).toEqual(['子牙', '达芬奇'])
    expect(c.rows.find((r) => r.code === 'davinci')!.status).toBe('retired')
    const ziya = c.rows.find((r) => r.code === 'ziya')!
    expect(ziya.playbooks.map((p) => p.file)).toEqual(['a.md'])
    expect(c.rows.find((r) => r.code === 'davinci')!.warnings.join()).toContain('操作手册')
    expect(c.notes.join()).toContain('README')
  })
  it('flags files listed in README but missing on disk', () => {
    const c = buildCatalog(repo({ 'docs/agents/README.md': README }))
    expect(c.rows[0].warnings.join()).toContain('文件缺失')
  })
})

describe('whitelist / path traversal', () => {
  const root = () => repo({
    'docs/agents/README.md': README, 'docs/agents/10-alpha.md': '# 示例甲',
    'docs/sops/alpha-rules.md': '# r', 'docs/clients/secret-client.md': '# secret', 'package.json': '{}',
  })
  it.each([
    ['agents', '../../package.json'], ['agents', '..%2F..%2Fpackage.json'], ['sops', '../clients/secret-client.md'],
    ['clients', 'secret-client.md'], ['agents', 'README.md'], ['sops', 'not-listed.md'],
  ])('%s/%s is not allowed', (kind, file) => {
    const r = root()
    expect(readAllowedDoc(buildCatalog(r), kind, file, r)).toEqual({ ok: false, reason: 'not_allowed' })
  })
  it('listed file reads; listed-but-missing is unreadable, not not_allowed', () => {
    const r = root()
    const c = buildCatalog(r)
    expect(readAllowedDoc(c, 'sops', 'alpha-rules.md', r).ok).toBe(true)
    expect(readAllowedDoc(c, 'agents', '80-beta.md', r)).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('doc links', () => {
  const allowed = new Set(['sops/a.md', 'agents/10-ziya.md'])
  it('whitelisted doc → in-app page', () => {
    expect(resolveDocLink('../sops/a.md', 'agents', allowed)).toEqual({ href: '/dashboard/admin/agents/sops/a.md', external: false })
    expect(resolveDocLink('10-ziya.md#x', 'agents', allowed).href).toBe('/dashboard/admin/agents/agents/10-ziya.md#x')
  })
  it('other folders → GitHub; web links untouched; escaping root is neutralised', () => {
    expect(resolveDocLink('../clients/x.md', 'agents', allowed).href).toBe('https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/clients/x.md')
    expect(resolveDocLink('https://example.com', 'sops', allowed)).toEqual({ href: 'https://example.com', external: true })
    expect(resolveDocLink('../../../../etc/passwd', 'sops', allowed).href).toBe('#')
  })
})

describe('doc header', () => {
  it('fills known fields and marks the rest 待补', () => {
    const h = parseDocHeader('# T\n\n- **负责**：示例甲\n> 状态：在用\n')
    expect(h['负责']).toBe('示例甲')
    expect(h['状态']).toBe('在用')
    expect(h['风险']).toBe('待补')
  })
  it('splits several fields on one line', () => {
    const h = parseDocHeader('> 负责：甲 | 范围：乙\n> 状态：**在用** ｜ 日期：d ｜ 最后核实：v ｜ 风险：C')
    expect([h['负责'], h['范围'], h['状态'], h['日期'], h['最后核实'], h['风险'], h['依据']]).toEqual(['甲', '乙', '在用', 'd', 'v', 'C', '待补'])
  })
})

describe('real README format', () => {
  it('归谁 ownership is whitelisted, including a #3339-shaped extra table', () => {
    const text = readFileSync(join(process.cwd(), 'docs/agents/README.md'), 'utf8')
    const extra = '## 经验手册\n\n| 目录 | 归谁 | 说明 |\n|---|---|---|\n| [`docs/playbooks/social/`](../playbooks/social/README.md) | 苏东坡 `sudongpo` | 经验 |\n## 帮手\n\n| 中文名 | 代号 | 性质 | 档案 | 操作手册 |\n|---|---|---|---|---|\n| 齐白石 | `qibaishi` | 名单外 | [62](./62-qibaishi.md) | [ui](../sops/ui.md) |\n'
    const p = parseReadme(`${text}\n${extra}`)
    expect(p.ownership.some((o) => o.playbooksRaw.includes('ads-agent-playbook') && o.ownerRaw.includes('卫青'))).toBe(true)
    expect(p.ownership.some((o) => o.ownerRaw.includes('待 ME Video'))).toBe(true)
    expect(p.agents.some((a) => a.code === 'weiqing')).toBe(true)
    expect(p.agents.some((a) => a.code === 'qibaishi')).toBe(true)
    const c = buildCatalog(process.cwd())
    expect(c.rows.find((r) => r.code === 'weiqing')?.playbooks.some((x) => x.file.includes('ads-agent-playbook'))).toBe(true)
    expect(c.allowed.has('sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md')).toBe(true)
    const h = parseDocHeader(text)
    expect([h['负责'], h['日期'], h['风险'], h['范围'].includes('docs/agents'), h['最后核实'].includes('只核对'), h['状态'].includes('｜')]).toEqual(['待 PM 指定', '2026-10-27', 'C（仅文档）', true, true, false])
  })
})

describe('isGlobalAdmin', () => {
  const mk = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null })
  it('only unscoped admin passes', () => {
    expect(isGlobalAdmin(mk({ 'x-user-role': 'admin', 'x-user-tier': 'admin' }))).toBe(true)
    expect(isGlobalAdmin(mk({ 'x-user-role': 'admin', 'x-user-tier': 'admin', 'x-allowed-client-id': 'c1' }))).toBe(false)
    expect(isGlobalAdmin(mk({ 'x-user-role': 'client-viewer', 'x-user-tier': 'paid_client' }))).toBe(false)
    expect(isGlobalAdmin(mk({}))).toBe(false)
  })
})
