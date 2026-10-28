import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let headerMap: Record<string, string> = {}
vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => headerMap[k] ?? null }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) },
  notFound: () => { throw new Error('NOT_FOUND') },
}))

import AgentsPage from '../page'
import AgentDocPage from '../[kind]/[...file]/page'
import { DocMarkdown } from '../_components/DocMarkdown'

const ADMIN = { 'x-user-role': 'admin', 'x-user-tier': 'admin' }
beforeEach(() => { headerMap = {} })

describe('page gate', () => {
  it.each([
    ['not logged in (no headers)', {}],
    ['client member / fde', { 'x-user-role': 'client-viewer', 'x-user-tier': 'paid_client', 'x-allowed-client-id': 'c1' }],
    ['self_serve', { 'x-user-role': 'client-viewer', 'x-user-tier': 'self_serve', 'x-allowed-client-id': 'c1' }],
    ['scoped admin', { ...ADMIN, 'x-allowed-client-id': 'c1' }],
  ])('%s is sent to /unauthorized (list)', async (_n, hdr) => {
    headerMap = hdr
    await expect(AgentsPage()).rejects.toThrow('REDIRECT:/unauthorized')
  })
  it('scoped admin is bounced from the doc page too', async () => {
    headerMap = { ...ADMIN, 'x-allowed-client-id': 'c1' }
    await expect(AgentDocPage({ params: Promise.resolve({ kind: 'agents', file: '10-ziya.md' }) })).rejects.toThrow('REDIRECT:/unauthorized')
  })
  it('global admin sees the list with no write controls', async () => {
    headerMap = ADMIN
    const { container } = render(await AgentsPage())
    expect(screen.getByText('Agent 与手册')).toBeTruthy()
    expect(screen.getByText('读哪些规则')).toBeTruthy()
    expect(screen.getByText('进不进提示词')).toBeTruthy()
    expect(screen.getByText('最后核实')).toBeTruthy()
    expect(screen.getAllByText('待采纳经验读不到').length).toBeGreaterThan(0)
    expect(container.querySelector('button, form, input, textarea')).toBeNull()
    expect(container.textContent).toContain('改文档请走 GitHub')
    expect(container.textContent).not.toMatch(/[{]"/)
    expect(container.textContent).not.toContain('规则总索引读不到')
  })
})

describe('doc page 404s', () => {
  it.each([
    ['agents', '../../package.json'], ['agents', '..%2F..%2Fpackage.json'], ['sops', '../clients/x.md'],
    ['clients', 'x.md'], ['agents', 'does-not-exist.md'],
  ])('%s/%s → 404', async (kind, file) => {
    headerMap = ADMIN
    await expect(AgentDocPage({ params: Promise.resolve({ kind, file }) })).rejects.toThrow('NOT_FOUND')
  })
  it('opens a real profile', async () => {
    headerMap = ADMIN
    const { container } = render(await AgentDocPage({ params: Promise.resolve({ kind: 'agents', file: '10-ziya.md' }) }))
    expect(container.textContent).toContain('子牙')
    expect(container.textContent).toContain('待补')
  })
  it('opens a nested playbook and blocks a path that climbs out', async () => {
    headerMap = ADMIN
    const { container } = render(await AgentDocPage({ params: Promise.resolve({ kind: 'playbooks', file: ['ads', 'meta-general.md'] }) }))
    expect(container.textContent).toContain('Meta 广告经验手册')
    expect(container.querySelector('button, form, input, textarea')).toBeNull()
    await expect(AgentDocPage({ params: Promise.resolve({ kind: 'playbooks', file: ['..', 'clients', 'x.md'] }) })).rejects.toThrow('NOT_FOUND')
  })
})

describe('DocMarkdown', () => {
  const md = '# 标题\n\n| 列A | 列B |\n|---|---|\n| 1 | [去](../sops/a.md) |\n\n- 项一 **粗**\n\n<script>alert(1)</script>'
  it('renders tables, links and never raw HTML', () => {
    const { container } = render(<DocMarkdown text={md} from="agents" allowed={new Set(['sops/a.md'])} />)
    expect(container.querySelectorAll('table th')).toHaveLength(2)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/admin/agents/sops/a.md')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('粗')
  })
})

describe('read-only guarantee', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? (f === '__tests__' ? [] : walk(p)) : [p]
    })
  }
  it('no API route and no write handlers/forms under the feature', () => {
    const files = walk(join(__dirname, '..'))
    expect(files.some((f) => /route\.ts$/.test(f))).toBe(false)
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/<form|<button|onSubmit|method:\s*['"](POST|PUT|PATCH|DELETE)/)
  })
})
