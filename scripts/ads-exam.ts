// 广告统一考卷：一条命令跑出分数。
// 用法：npx tsx scripts/ads-exam.ts
// 只跑登记表里列到的测试文件（离线、不调大模型、不碰线上数据），按题号出分数表；
// 有答错或找不到测试的题时退出码 1。
// 改任何广告判断规则前后各跑一次，把第一行分数贴进改动单。

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countExamCorrectionCandidates } from '../src/lib/ads-strategy/exam/corrections'
import { ADS_EXAM_QUESTIONS } from '../src/lib/ads-strategy/exam/questions'
import {
  scoreExam,
  formatScoreboard,
  type ExamTestResult,
} from '../src/lib/ads-strategy/exam/score'

function uniqueFiles(): string[] {
  const seen = new Set<string>()
  const files: string[] = []
  for (const question of ADS_EXAM_QUESTIONS) {
    if (!seen.has(question.file)) {
      seen.add(question.file)
      files.push(question.file)
    }
  }
  return files
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function readArray(record: Record<string, unknown>, key: string): unknown[] | null {
  const value = record[key]
  return Array.isArray(value) ? value : null
}

function toResults(report: unknown): ExamTestResult[] {
  if (!isRecord(report)) return []
  const testResults = readArray(report, 'testResults')
  if (testResults === null) return []

  const results: ExamTestResult[] = []
  for (const fileEntry of testResults) {
    if (!isRecord(fileEntry)) continue
    const file = readString(fileEntry, 'name')
    const assertions = readArray(fileEntry, 'assertionResults')
    if (file === null || assertions === null) continue

    for (const assertion of assertions) {
      if (!isRecord(assertion)) continue
      const fullName = readString(assertion, 'fullName')
      const status = readString(assertion, 'status')
      if (fullName === null || status === null) continue
      results.push({ file, fullName, status })
    }
  }
  return results
}

function readReport(outputFile: string): unknown {
  try {
    return JSON.parse(readFileSync(outputFile, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

function runVitest(files: readonly string[]): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'ads-exam-'))
  const outputFile = join(dir, 'report.json')
  try {
    // vitest 的退出码不作数：答错 / it.fails 都要靠分数表判，不当崩溃处理
    spawnSync('npx', ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${outputFile}`], {
      stdio: ['ignore', 'ignore', 'inherit'],
      encoding: 'utf8',
    })
    return readReport(outputFile)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main(): void {
  const report = runVitest(uniqueFiles())
  if (report === undefined) {
    console.error('考卷没跑起来：vitest 没有产出报告')
    process.exit(2)
  }
  const score = scoreExam(ADS_EXAM_QUESTIONS, toResults(report))
  const candidateCount = countExamCorrectionCandidates()
  console.log(formatScoreboard(score))
  console.log('')
  console.log(
    `考卷候选题（PM 纠正沉淀，未并入正式题库）：${candidateCount} 道`,
  )
  process.exit(score.ok ? 0 : 1)
}

main()
