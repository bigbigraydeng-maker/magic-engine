/**
 * Fail unless a vitest JSON report is exactly one expected file, with no
 * failures, no skips, and at least MIN_PASSED passing tests.
 *
 * Kernel and tour-catalog checks share this so a pull request cannot quiet
 * the floor by renaming, skipping, or swapping in a different file.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {{ testResults?: { name: string }[], numPassedTests: number, numFailedTests: number, numPendingTests: number, numTodoTests: number }} report
 * @param {string} expectedFile
 * @param {number} minPassed
 */
export function judgeVitestJson(report, expectedFile, minPassed) {
  const files = (report.testResults || []).map((item) => item.name)
  const skipped = report.numPendingTests + report.numTodoTests
  const problems = []
  if (files.length !== 1 || files[0] !== expectedFile) {
    problems.push(`跑的不是那一个真文件（应当只有 ${expectedFile}）`)
  }
  if (report.numFailedTests !== 0) problems.push(`有 ${report.numFailedTests} 条失败`)
  if (skipped !== 0) problems.push(`有 ${skipped} 条被跳过（skip / todo / 名字过滤）`)
  if (!(report.numPassedTests >= minPassed)) problems.push(`只跑通了 ${report.numPassedTests} 条（下限 ${minPassed}）`)
  return {
    files,
    skipped,
    problems,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
  }
}

function main() {
  const resultsPath = process.env.RESULTS ?? ''
  const minPassed = Number(process.env.MIN_PASSED)
  const relativeFile = process.env.EXPECTED_FILE ?? ''
  const label = process.env.FAIL_LABEL || '测试'
  if (!resultsPath || !relativeFile || !Number.isFinite(minPassed)) {
    console.log(`::error::${label}没有完整跑过：缺少 RESULTS / MIN_PASSED / EXPECTED_FILE`)
    process.exit(1)
  }
  const expected = join(process.env.GITHUB_WORKSPACE || process.cwd(), relativeFile)
  const report = JSON.parse(readFileSync(resultsPath, 'utf8'))
  const judged = judgeVitestJson(report, expected, minPassed)
  const summary = `files=${JSON.stringify(judged.files)} passed=${judged.passed} failed=${judged.failed} skipped=${judged.skipped} floor=${minPassed}`
  console.log(summary)
  for (const problem of judged.problems) console.log(`::error::${label}没有完整跑过：${problem}`)
  if (judged.problems.length > 0) process.exit(1)
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('confirm-vitest-json.mjs')
if (isDirectRun) main()
