/**
 * 全仓扫描：除白名单文件外，没有任何代码直接写 `contacts.display_name`。
 *
 * 为什么要有它：名字清洗（不许邮箱 / 电话当名字）靠「所有写名字的地方都先过 cleanDisplayName」。
 * 以后谁新加一处直接 `display_name:` 写库，这条测试会红，提醒他先过清洗（或把文件加进白名单并写明理由）。
 */

import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')

/** 这些文件写 contacts.display_name，且都先过了 cleanDisplayName（或写入的值来自已清洗的调用链）。 */
const ALLOWED = new Set([
  'src/lib/crm/identity.ts', // resolveContact：入口清洗
  'src/lib/messenger/link-contacts.ts', // 补名字：cleanDisplayName(leadName)
  'src/app/api/clients/[id]/messenger/unclaimed/claim/route.ts', // 手工认领：cleanDisplayName(newContactName)
])

describe('只有清洗过的值才能写 contacts.display_name', () => {
  it('src 里直接写 display_name 的非测试文件都在白名单里', () => {
    const out = execSync(
      `grep -rlE "display_name:\\s" src --include=*.ts --include=*.tsx || true`,
      { cwd: ROOT, encoding: 'utf-8', shell: '/bin/bash' },
    )
    const files = out
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f && !f.includes('__tests__') && !/\.test\.tsx?$/.test(f))
    // 只关心「写 contacts 表」的文件：同时出现 from('contacts') 且有 insert( / update( / upsert(
    const writers = files.filter((f) => {
      const src = execSync(`cat "${f}"`, { cwd: ROOT, encoding: 'utf-8' })
      return /from\('contacts'\)/.test(src) && /\.(insert|update|upsert)\(/.test(src) && /display_name:\s/.test(src)
    })
    const unexpected = writers.filter((f) => !ALLOWED.has(f))
    expect(unexpected).toEqual([])
  })

  it('白名单里的文件都真的 import 了 cleanDisplayName（不只是「别新增」，还验证「已有的真过了清洗」）', () => {
    for (const f of ALLOWED) {
      const src = execSync(`cat "${f}"`, { cwd: ROOT, encoding: 'utf-8' })
      expect(src, `${f} 应该 import cleanDisplayName`).toMatch(/cleanDisplayName/)
    }
  })

  // 已知盲区（提醒型护栏，不是强保证）：扫不到 scripts/、用展开 / 变量 / RPC / SQL 迁移写 display_name 的写法。
  // scripts/crm-clean-email-names.ts 有意把名字写成 NULL（清理历史数据），不在扫描范围内。
})
