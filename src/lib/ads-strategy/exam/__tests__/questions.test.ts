import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ADS_EXAM_QUESTIONS, type ExamQuestion } from '../questions'
import { scoreExam, formatScoreboard, type ExamTestResult } from '../score'

describe('广告考卷登记表', () => {
  it('题号唯一、从 Q01 连续编号', () => {
    const ids = ADS_EXAM_QUESTIONS.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    const expected = ids.map((_, i) => `Q${String(i + 1).padStart(2, '0')}`)
    expect(ids).toEqual(expected)
  })

  it('至少 51 道题（Q01–Q25 规则回归 + Q26–Q51 agent 离线回放）', () => {
    expect(ADS_EXAM_QUESTIONS.length).toBe(51)
  })

  it('每道题的测试文件存在，且 match 原文真的出现在文件里（防止测试改名后登记表悄悄失效）', () => {
    for (const q of ADS_EXAM_QUESTIONS) {
      const path = join(process.cwd(), q.file)
      expect(existsSync(path), `${q.id} 测试文件不存在：${q.file}`).toBe(true)
      const text = readFileSync(path, 'utf8')
      expect(text.includes(q.match), `${q.id} 的 match 原文没出现在 ${q.file}：${q.match}`).toBe(
        true,
      )
    }
  })

  it('已知待修题对应的测试文件里有 it.fails，还没出题的有 it.todo', () => {
    for (const q of ADS_EXAM_QUESTIONS) {
      if (q.expect === 'known_fail') {
        const text = readFileSync(join(process.cwd(), q.file), 'utf8')
        expect(text.includes('it.fails('), `${q.id} 的测试文件里没有 it.fails(`).toBe(true)
      }
      if (q.expect === 'todo') {
        const text = readFileSync(join(process.cwd(), q.file), 'utf8')
        expect(text.includes('it.todo('), `${q.id} 的测试文件里没有 it.todo(`).toBe(true)
      }
    }
  })
})

function q(
  id: string,
  expectation: ExamQuestion['expect'],
  match: string = 'M ' + id,
): ExamQuestion {
  return { id, title: 't', source: 's', file: 'src/x.test.ts', match, expect: expectation }
}

function t(
  fullName: string,
  status: string,
  file: string = '/abs/repo/src/x.test.ts',
): ExamTestResult {
  return { file, fullName, status }
}

describe('scoreExam 判分', () => {
  it('pass + 全部 passed → right，ok 为 true', () => {
    const score = scoreExam([q('Q01', 'pass')], [t('M Q01', 'passed')])
    expect(score.results[0].verdict).toBe('right')
    expect(score.ok).toBe(true)
  })

  it('pass + 有一条 failed → wrong，ok 为 false', () => {
    const score = scoreExam(
      [q('Q01', 'pass')],
      [t('M Q01 a', 'passed'), t('M Q01 b', 'failed')],
    )
    expect(score.results[0].verdict).toBe('wrong')
    expect(score.ok).toBe(false)
  })

  it('pass + 有一条 skipped → wrong', () => {
    const score = scoreExam(
      [q('Q01', 'pass')],
      [t('M Q01 a', 'passed'), t('M Q01 b', 'skipped')],
    )
    expect(score.results[0].verdict).toBe('wrong')
  })

  it('一条测试都没命中 → missing，ok 为 false', () => {
    const score = scoreExam([q('Q01', 'pass')], [t('别的测试', 'passed')])
    expect(score.results[0].verdict).toBe('missing')
    expect(score.ok).toBe(false)
  })

  it('不同文件里同名测试不算命中 → missing', () => {
    const score = scoreExam([q('Q01', 'pass')], [t('M Q01', 'passed', 'src/y.test.ts')])
    expect(score.results[0].verdict).toBe('missing')
  })

  it('known_fail + 全部 passed → known_fail，ok 为 true', () => {
    const score = scoreExam([q('Q01', 'known_fail')], [t('M Q01', 'passed')])
    expect(score.results[0].verdict).toBe('known_fail')
    expect(score.ok).toBe(true)
  })

  it('known_fail + 有一条 failed → known_fail_now_right，ok 为 true', () => {
    const score = scoreExam(
      [q('Q01', 'known_fail')],
      [t('M Q01 a', 'passed'), t('M Q01 b', 'failed')],
    )
    expect(score.results[0].verdict).toBe('known_fail_now_right')
    expect(score.ok).toBe(true)
  })

  it('todo + 全部 todo → todo；todo + passed → right', () => {
    const todoScore = scoreExam([q('Q01', 'todo')], [t('M Q01', 'todo')])
    expect(todoScore.results[0].verdict).toBe('todo')
    const passedScore = scoreExam([q('Q01', 'todo')], [t('M Q01', 'passed')])
    expect(passedScore.results[0].verdict).toBe('right')
  })

  it('统计各判定数量', () => {
    const questions: ExamQuestion[] = [
      q('Q01', 'pass'),
      q('Q02', 'pass'),
      q('Q03', 'known_fail'),
      q('Q04', 'todo'),
      q('Q05', 'pass'),
    ]
    const tests: ExamTestResult[] = [
      t('M Q01', 'passed'),
      t('M Q02', 'failed'),
      t('M Q03', 'passed'),
      t('M Q04', 'todo'),
    ]
    const score = scoreExam(questions, tests)
    expect(score.total).toBe(5)
    expect(score.right).toBe(1)
    expect(score.wrong).toBe(1)
    expect(score.knownFail).toBe(1)
    expect(score.todo).toBe(1)
    expect(score.missing).toBe(1)
  })

  it('Windows 反斜杠路径也能匹配', () => {
    const score = scoreExam(
      [q('Q01', 'pass')],
      [t('M Q01', 'passed', 'C:\\repo\\src\\x.test.ts')],
    )
    expect(score.results[0].verdict).toBe('right')
  })
})

describe('formatScoreboard', () => {
  it('首行是汇总，且没有 ❌ 行', () => {
    const score = scoreExam(
      [q('Q01', 'pass'), q('Q02', 'known_fail')],
      [t('M Q01', 'passed'), t('M Q02', 'passed')],
    )
    const lines = formatScoreboard(score).split('\n')
    expect(lines[0]).toBe('广告考卷：答对 1 / 共 2 题（已知待修 1，还没出题 0）')
    expect(lines.some((l) => l.includes('❌'))).toBe(false)
  })

  it('有答错题时输出包含「答错 1 题」和以 ❌ 开头的行', () => {
    const score = scoreExam([q('Q01', 'pass')], [t('M Q01', 'failed')])
    const lines = formatScoreboard(score).split('\n')
    expect(lines.some((l) => l.includes('答错 1 题'))).toBe(true)
    expect(lines.some((l) => l.startsWith('❌'))).toBe(true)
  })

  it('每道题的行包含题号和来源', () => {
    const score = scoreExam([q('Q01', 'pass')], [t('M Q01', 'passed')])
    const lines = formatScoreboard(score).split('\n')
    const questionLine = lines.find((l) => l.includes('Q01'))
    expect(questionLine).toBeDefined()
    expect(questionLine).toContain('Q01')
    expect(questionLine).toContain('s')
  })
})
