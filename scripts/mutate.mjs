#!/usr/bin/env node
/**
 * 变异测试 —— 故意把代码改坏，测试必须变红。
 *
 * 🔴 为什么需要它：**「测试全绿」在本仓不构成任何证据**。
 *    2026-08-05 一天之内挖出的 bug 全是同一个形状：代码查一张不存在的表、
 *    或把「查失败」当成「没数据」，而假数据层配合着返回空，测试一直绿。
 *    唯一能证明一条断言真的锁住了东西的办法，是**把它该防的东西放回去，看它红不红**。
 *
 * 🔴 探针自己会撒谎：同一天里我用 sed 做替换，目标字符串没匹配上，
 *    脚本却报成「变异存活（测试没抓住）」—— 我差点据此去改测试。
 *    所以这个脚本**先自证替换命中了**，没命中报「探针失效」，绝不报「存活」。
 *
 * 用法（配置文件形式，避免命令行转义地狱）：
 *
 *   node scripts/mutate.mjs mutations.json
 *
 *   // mutations.json
 *   [
 *     {
 *       "name": "把错误吞掉当成没数据",
 *       "file": "src/lib/foo.ts",
 *       "test": "src/lib/__tests__/foo.test.ts",
 *       "find": "if (error) return { ok: false }",
 *       "replace": "if (error) return { ok: true }"
 *     }
 *   ]
 *
 * 退出码：全部被抓住 = 0；有存活或探针失效 = 1。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const configPath = process.argv[2]
if (!configPath) {
  console.error('用法: node scripts/mutate.mjs <mutations.json>')
  process.exit(2)
}

/** @type {Array<{name:string,file:string,test:string,find:string,replace:string}>} */
const mutations = JSON.parse(readFileSync(configPath, 'utf8'))

// 先把所有会被改到的文件原样存下来，无论中途发生什么都要还原
const originals = new Map()
for (const m of mutations) {
  const p = resolve(m.file)
  if (!originals.has(p)) originals.set(p, readFileSync(p, 'utf8'))
}

function restoreAll() {
  for (const [p, text] of originals) writeFileSync(p, text)
}

// 被 Ctrl-C / 异常打断也要还原 —— 留一个被改坏的源文件在工作区是最坏的结果
process.on('SIGINT', () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(2) })

let killed = 0
let survived = 0
let broken = 0

for (const m of mutations) {
  const p = resolve(m.file)
  const original = originals.get(p)

  // ── 探针自证：没匹配上就报「探针失效」，绝不报「存活」 ──
  const occurrences = original.split(m.find).length - 1
  if (occurrences === 0) {
    console.log(`⚠️  探针失效  ← ${m.name}\n    目标字符串没在 ${m.file} 里匹配到，这次变异**根本没打进去**`)
    broken++
    continue
  }
  if (occurrences > 1) {
    console.log(`⚠️  探针不精确  ← ${m.name}\n    目标字符串在 ${m.file} 里出现 ${occurrences} 次，只会替换第一处；请写得更具体`)
  }

  const mutated = original.replace(m.find, m.replace)
  if (mutated === original) {
    console.log(`⚠️  探针无效  ← ${m.name}\n    替换前后完全一样`)
    broken++
    continue
  }

  writeFileSync(p, mutated)
  const r = spawnSync('npx', ['vitest', 'run', m.test], { encoding: 'utf8' })
  writeFileSync(p, original)

  if (r.status !== 0) {
    console.log(`✅ 抓住  ← ${m.name}`)
    killed++
  } else {
    console.log(`❌ 存活  ← ${m.name}\n    ${m.test} 全绿 —— 这条断言没有锁住 ${m.name}`)
    survived++
  }
}

restoreAll()

// 还原自证：不是「我调用了还原」，是「文件内容真的等于原文」
for (const [p, text] of originals) {
  if (readFileSync(p, 'utf8') !== text) {
    console.error(`🔴 还原失败：${p} 跟原文不一致，请手动 git checkout 该文件`)
    process.exit(2)
  }
}

console.log(`\n抓住 ${killed} · 存活 ${survived} · 探针失效 ${broken}（文件已全部还原并核对）`)
process.exit(survived + broken > 0 ? 1 : 0)
