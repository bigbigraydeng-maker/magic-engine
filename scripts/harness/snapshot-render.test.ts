import { describe, expect, it } from 'vitest'

import { DOT_SYMBOLS, attentionItems, escapeHtml, formatAgo, formatNz, renderHtml, windowStatus } from './snapshot-render.mjs'

type DotState = 'ok' | 'warn' | 'bad' | 'none'

type Window = {
  number: string | null
  group: string
  title: string
  branch: string
  risk: 'A' | 'B' | 'C' | '?'
  prNumber: number | null
  lastActivityAt: string
  dots: { opened: DotState; merged: DotState; verified: DotState }
}

type Collision = {
  file: string
  prs: Array<{ number: number; headRefName: string; window: string | null }>
}

type ArchiveSuggestion = {
  id: string
  number: string | null
  group: string
  lastActivityAt: string
}

type Grok = {
  openCount: number
  openPrs: Array<{ number: number; idleDays: number | null; isDraft: boolean }>
  oldestIdleDays: number | null
  mergedRecent: number
  closedRecent: number
  days: number
}

type Model = {
  generatedAt: string
  collisionsOtherCount?: number
  grok?: Grok
  windows: Window[]
  inactiveCount: number
  collisions: Collision[]
  archiveSuggestions: ArchiveSuggestion[]
  errors: string[]
}

const SECRET_TITLE = 'SECRET-TITLE-XYZ'
const SECRET_BRANCH = 'secret/branch-xyz'
const SECRET_FILE = 'src/lib/secret-client/file-xyz.ts'
const SECRET_HEAD = 'secret/head-xyz'

function window(overrides: Partial<Window> = {}): Window {
  return {
    number: '74',
    group: 'CTS',
    title: SECRET_TITLE,
    branch: SECRET_BRANCH,
    risk: 'A',
    prNumber: 101,
    lastActivityAt: '2026-10-26T11:00:00.000Z',
    dots: { opened: 'ok', merged: 'warn', verified: 'bad' },
    ...overrides,
  }
}

function model(overrides: Partial<Model> = {}): Model {
  return {
    generatedAt: '2026-10-26T12:00:00.000Z',
    windows: [window()],
    inactiveCount: 2,
    collisions: [
      {
        file: SECRET_FILE,
        prs: [
          { number: 101, headRefName: SECRET_HEAD, window: '74' },
          { number: 102, headRefName: 'secret/head-other', window: null },
        ],
      },
    ],
    archiveSuggestions: [
      { id: 'a1', number: '70', group: 'CTS', lastActivityAt: '2026-10-01T00:00:00.000Z' },
    ],
    errors: [],
    ...overrides,
  }
}

describe('escapeHtml', () => {
  it('escapes all five special characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;')
  })

  it('handles null, undefined and numbers', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(42)).toBe('42')
  })
})

describe('formatNz', () => {
  it('formats an ISO timestamp in Pacific/Auckland time', () => {
    expect(formatNz('2026-10-26T12:00:00.000Z')).toBe('10-27 01:00')
  })

  it('returns a fallback for unparsable input', () => {
    expect(formatNz('nope')).toBe('时间未知')
  })
})

describe('DOT_SYMBOLS', () => {
  it('exposes the four symbols', () => {
    expect(DOT_SYMBOLS).toEqual({ ok: '●', warn: '◐', bad: '×', none: '—' })
  })
})

describe('renderHtml mobile mode', () => {
  const html = renderHtml(model(), 'mobile')

  it('does not leak titles, branches, file paths or head refs', () => {
    expect(html).not.toContain(SECRET_TITLE)
    expect(html).not.toContain(SECRET_BRANCH)
    expect(html).not.toContain(SECRET_FILE)
    expect(html).not.toContain(SECRET_HEAD)
  })

  it('shows window number, group, risk, dots and collision PR numbers', () => {
    expect(html).toContain('74号')
    expect(html).toContain('CTS')
    expect(html).toContain('风险A')
    expect(html).toContain('●')
    expect(html).toContain('◐')
    expect(html).toContain('×')
    const blank = window({ dots: { opened: 'none', merged: 'none', verified: 'none' } })
    expect(renderHtml(model({ windows: [blank] }), 'mobile')).toContain(DOT_SYMBOLS.none)
    expect(html).toContain('PR#101')
    expect(html).toContain('PR#102')
  })

  it('treats an unknown mode like mobile', () => {
    const other = renderHtml(model(), 'whatever' as 'mobile')
    expect(other).not.toContain(SECRET_TITLE)
    expect(other).not.toContain(SECRET_BRANCH)
    expect(other).not.toContain(SECRET_FILE)
    expect(other).not.toContain(SECRET_HEAD)
  })
})

describe('renderHtml full mode', () => {
  const html = renderHtml(model(), 'full')

  it('shows titles, branches, file paths and head refs', () => {
    expect(html).toContain(SECRET_TITLE)
    expect(html).toContain(SECRET_BRANCH)
    expect(html).toContain(SECRET_FILE)
    expect(html).toContain(SECRET_HEAD)
  })

  it('escapes a script tag in the title', () => {
    const evil = renderHtml(
      model({ windows: [window({ title: '<script>alert(1)</script>' })] }),
      'full',
    )
    expect(evil).not.toContain('<script>')
    expect(evil).toContain('&lt;script&gt;')
  })
})

describe('renderHtml errors banner', () => {
  it('shows the banner when errors are present', () => {
    const html = renderHtml(model({ errors: ['gh api failed'] }), 'mobile')
    expect(html).toContain('banner-error')
    expect(html).toContain('gh api failed')
  })

  it('omits the banner element when there are no errors', () => {
    const html = renderHtml(model({ errors: [] }), 'mobile')
    expect(html).not.toContain('class="banner-error"')
  })
})

describe('renderHtml empty states', () => {
  it('shows the empty messages', () => {
    const html = renderHtml(
      model({ windows: [], collisions: [], archiveSuggestions: [] }),
      'mobile',
    )
    expect(html).toContain('最近 3 天没有活跃窗口')
    expect(html).toContain('没有撞车')
    expect(html).toContain('<p class="empty">没有</p>')
  })

  it('shows 无编号 for a window without a number', () => {
    const html = renderHtml(model({ windows: [window({ number: null })] }), 'mobile')
    expect(html).toContain('无编号')
  })
})

describe('renderHtml groups', () => {
  it('renders one h2 per group', () => {
    const html = renderHtml(
      model({
        windows: [
          window({ number: '1', group: 'CTS' }),
          window({ number: '2', group: 'CTS' }),
          window({ number: '3', group: 'ME 广告' }),
        ],
      }),
      'mobile',
    )
    const headings = html.match(/<h2>/g) ?? []
    // 5 section headings (要你关注的 / 窗口 / 撞车 / Grok 的活 / 建议归档) + 2 group headings
    expect(headings).toHaveLength(7)
    expect(html).toContain('<h2>CTS</h2>')
    expect(html).toContain('<h2>ME 广告</h2>')
  })
})

describe('renderHtml archive overflow', () => {
  it('shows the remaining count when there are more than 20 suggestions', () => {
    const suggestions: ArchiveSuggestion[] = Array.from({ length: 25 }, (_, index) => ({
      id: `a${index}`,
      number: String(index),
      group: 'CTS',
      lastActivityAt: '2026-10-01T00:00:00.000Z',
    }))
    const html = renderHtml(model({ archiveSuggestions: suggestions }), 'mobile')
    expect(html).toContain('…还有 5 个')
  })
})

describe('renderHtml document shell', () => {
  it('starts with doctype and includes viewport and dark mode', () => {
    const html = renderHtml(model(), 'mobile')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('name="viewport"')
  })
})

describe('archive list cap', () => {
  it('prints exactly 20 rows when 25 are suggested', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `s${index}`,
      number: String(index + 1),
      group: 'CTS',
      lastActivityAt: '2026-10-01T00:00:00.000Z',
    }))
    const html = renderHtml(model({ archiveSuggestions: items }), 'mobile')
    expect(html.split('class="archive-number"').length - 1).toBe(20)
  })
})

describe('collisions among inactive windows', () => {
  it('shows only a count, in both modes, when some collisions are hidden', () => {
    const hidden = { ...model(), collisionsOtherCount: 7 }
    for (const mode of ['full', 'mobile'] as const) {
      expect(renderHtml(hidden, mode)).toContain('另有 7 处撞车只发生在不活跃窗口的 PR 之间，不显示')
    }
  })

  it('shows no such line when nothing is hidden', () => {
    expect(renderHtml(model(), 'mobile')).not.toContain('只发生在不活跃窗口')
    expect(renderHtml({ ...model(), collisionsOtherCount: 0 }, 'full')).not.toContain('只发生在不活跃窗口')
  })
})

function grok(overrides: Partial<Grok> = {}): Grok {
  return {
    openCount: 3,
    openPrs: [
      { number: 201, idleDays: 5, isDraft: false },
      { number: 202, idleDays: 2, isDraft: true },
      { number: 203, idleDays: null, isDraft: false },
    ],
    oldestIdleDays: 5,
    mergedRecent: 4,
    closedRecent: 1,
    days: 7,
    ...overrides,
  }
}

describe('renderHtml grok section', () => {
  it('shows the summary in both modes', () => {
    for (const mode of ['full', 'mobile'] as const) {
      const html = renderHtml(model({ grok: grok() }), mode)
      expect(html).toContain('<h2>Grok 的活</h2>')
      expect(html).toContain('还开着 3 个，最久的 5 天没动；最近 7 天合了 4 个，关掉没合的 1 个')
    }
  })

  it('omits the 最久 clause when oldestIdleDays is null', () => {
    const html = renderHtml(model({ grok: grok({ oldestIdleDays: null }) }), 'mobile')
    expect(html).toContain('还开着 3 个；最近 7 天合了 4 个，关掉没合的 1 个')
    expect(html).not.toContain('最久的')
  })

  it('marks draft PRs with 草稿', () => {
    const html = renderHtml(model({ grok: grok() }), 'mobile')
    expect(html).toContain('PR#202（2 天没动） 草稿')
  })

  it('shows 时间未知 when idleDays is null', () => {
    const html = renderHtml(model({ grok: grok() }), 'mobile')
    expect(html).toContain('PR#203（时间未知）')
  })

  it('caps the open PR list at 10 and shows the remainder', () => {
    const openPrs = Array.from({ length: 12 }, (_, index) => ({
      number: 300 + index,
      idleDays: index,
      isDraft: false,
    }))
    const html = renderHtml(model({ grok: grok({ openCount: 12, openPrs }) }), 'mobile')
    const listMatch = html.match(/<ul class="grok">([\s\S]*?)<\/ul>/)
    expect(listMatch).not.toBeNull()
    const listHtml = listMatch ? listMatch[1] : ''
    expect(listHtml.split('<li>').length - 1).toBe(10)
    expect(html).toContain('…还有 2 个')
  })

  it('shows the empty message when grok is missing', () => {
    const html = renderHtml(model(), 'mobile')
    expect(html).toContain('Grok 这一栏没有数据')
  })

  it('does not leak extra fields such as headRefName in mobile mode', () => {
    const leaky = {
      ...grok(),
      openPrs: [{ number: 201, idleDays: 5, isDraft: false, headRefName: 'secret/grok-branch' }],
    }
    const html = renderHtml(model({ grok: leaky }), 'mobile')
    expect(html).not.toContain('secret/grok-branch')
  })
})

describe('window label in collisions', () => {
  it('says N号窗口 for numbers and 无编号窗口 for unnumbered owners', () => {
    const collisions = [{ file: 'f', prs: [{ number: 1, headRefName: 'a', window: '74' }, { number: 2, headRefName: 'b', window: '无编号' }, { number: 3, headRefName: 'c', window: null }] }]
    const html = renderHtml(model({ collisions }), 'mobile')
    expect(html).toContain('PR#1（74号窗口）')
    expect(html).toContain('PR#2（无编号窗口）')
    expect(html).toContain('PR#3')
    expect(html).not.toContain('PR#3（')
  })
})

describe('formatAgo', () => {
  const NOW_ISO = '2026-10-26T12:00:00.000Z'
  const at = (minutesAgo: number) => new Date(Date.parse(NOW_ISO) - minutesAgo * 60000).toISOString()

  it('writes minutes, hours and days at the boundaries', () => {
    expect(formatAgo(at(0), NOW_ISO)).toBe('刚刚')
    expect(formatAgo(at(1), NOW_ISO)).toBe('1 分钟前')
    expect(formatAgo(at(59), NOW_ISO)).toBe('59 分钟前')
    expect(formatAgo(at(60), NOW_ISO)).toBe('1 小时前')
    expect(formatAgo(at(23 * 60 + 59), NOW_ISO)).toBe('23 小时前')
    expect(formatAgo(at(24 * 60), NOW_ISO)).toBe('1 天前')
    expect(formatAgo(at(3 * 24 * 60), NOW_ISO)).toBe('3 天前')
  })

  it('never goes negative and reports unknown for bad dates', () => {
    expect(formatAgo('2026-10-26T13:00:00.000Z', NOW_ISO)).toBe('刚刚')
    expect(formatAgo('nope', NOW_ISO)).toBe('时间未知')
    expect(formatAgo(NOW_ISO, 'nope')).toBe('时间未知')
  })
})

describe('windowStatus', () => {
  const dots = (verified: string, opened = 'ok') => ({ opened, merged: 'ok', verified })

  it('maps every PR situation to one plain label', () => {
    expect(windowStatus({ prNumber: null, dots: dots('none') })).toEqual({ label: '还没开 PR', tone: 'none' })
    expect(windowStatus({ prNumber: 1, prState: 'OPEN', dots: dots('none') })).toEqual({ label: 'PR 进行中', tone: 'info' })
    expect(windowStatus({ prNumber: 1, prState: 'OPEN', dots: dots('none', 'warn') })).toEqual({ label: '检查没过', tone: 'bad' })
    expect(windowStatus({ prNumber: 1, prState: 'CLOSED', dots: dots('none') })).toEqual({ label: 'PR 已关闭', tone: 'none' })
    expect(windowStatus({ prNumber: 1, prState: 'MERGED', dots: dots('none') })).toEqual({ label: '已合并', tone: 'ok' })
    expect(windowStatus({ prNumber: 1, prState: 'MERGED', dots: dots('warn') })).toEqual({ label: '已合并·待验证', tone: 'warn' })
    expect(windowStatus({ prNumber: 1, prState: 'MERGED', dots: dots('ok') })).toEqual({ label: '已合并·已验证', tone: 'ok' })
    expect(windowStatus({ prNumber: 1, prState: 'MERGED', dots: dots('bad') })).toEqual({ label: '验证失败', tone: 'bad' })
  })
})

describe('attention list and summary tiles', () => {
  const merged = (number: string | null, verified: string, prNumber = 5) =>
    window({ number, prNumber, prState: 'MERGED', dots: { opened: 'ok', merged: 'ok', verified } } as Partial<Window>)

  it('says nothing needs attention when everything is clean', () => {
    const html = renderHtml(model({ windows: [merged('74', 'ok')], collisions: [] }), 'mobile')
    expect(html).toContain('现在没有需要你处理的')
  })

  it('lists failures, pending verification, collisions and stale Grok PRs by number only', () => {
    const items = attentionItems({
      windows: [
        merged('74', 'bad'),
        merged('18', 'warn', 6),
        merged(null, 'warn', 7),
      ],
      collisions: [{ file: 'src/secret.ts', prs: [{ number: 9, headRefName: 'b', window: '74' }, { number: 10, headRefName: 'c', window: null }] }],
      grok: { openCount: 2, openPrs: [{ number: 3, idleDays: 5, isDraft: false }, { number: 4, idleDays: 1, isDraft: false }], oldestIdleDays: 5, mergedRecent: 0, closedRecent: 0, days: 7 },
    })
    const text = items.map((item) => item.text).join('\n')
    expect(text).toContain('74号：验证失败')
    expect(text).toContain('2 个已合并的窗口，台账还没验完：18号、PR#7')
    expect(text).toContain('1 处撞车')
    expect(text).toContain('PR#9、PR#10')
    expect(text).toContain('Grok 有 1 个 PR 超过 3 天没动：PR#3')
    expect(text).not.toContain('src/secret.ts')
    expect(items.filter((item) => item.tone === 'bad')).toHaveLength(2)
  })

  it('caps a long id list at 8 and counts the rest', () => {
    const many = Array.from({ length: 10 }, (_, index) => merged(String(index + 1), 'warn', index + 20))
    const text = attentionItems({ windows: many, collisions: [], grok: null }).map((item) => item.text).join('')
    expect(text).toContain('等 10 个')
    expect(text).not.toContain('9号')
  })

  it('shows the five summary tiles with the right numbers', () => {
    const html = renderHtml(
      model({
        windows: [merged('1', 'warn'), merged('2', 'ok'), window({ prNumber: 8, prState: 'OPEN', dots: { opened: 'ok', merged: 'none', verified: 'none' } } as Partial<Window>)],
        collisions: [{ file: 'f', prs: [{ number: 1, headRefName: 'a', window: null }, { number: 2, headRefName: 'b', window: null }] }],
        grok: { openCount: 4, openPrs: [], oldestIdleDays: null, mergedRecent: 1, closedRecent: 0, days: 7 },
      } as Partial<Model>),
      'mobile',
    )
    const tile = (value: number, label: string, tone: string) => `<div class="tile tile-${tone}"><div class="tile-value">${value}</div><div class="tile-label">${label}</div></div>`
    expect(html).toContain(tile(3, '活跃窗口', 'none'))
    expect(html).toContain(tile(1, 'PR 进行中', 'info'))
    expect(html).toContain(tile(1, '待验证', 'warn'))
    expect(html).toContain(tile(1, '撞车', 'bad'))
    expect(html).toContain(tile(4, 'Grok 开着', 'none'))
  })

  it('shows the relative time and keeps the absolute time as a tooltip', () => {
    const html = renderHtml(model({ windows: [window({ lastActivityAt: '2026-10-26T11:00:00.000Z' })] }), 'mobile')
    expect(html).toContain('1 小时前')
    expect(html).toContain('title="10-27 00:00"')
  })
})

describe('window row details', () => {
  const noPr = () => window({ number: null, prNumber: null, risk: '?', dots: { opened: 'none', merged: 'none', verified: 'none' } })

  it('shows no progress steps and no risk text for a window without a PR', () => {
    const html = renderHtml(model({ windows: [noPr()] }), 'mobile')
    expect(html).not.toContain('class="steps"')
    expect(html).not.toContain('风险?')
    expect(html).toContain('还没开 PR')
  })

  it('uses the title as the headline for an unnumbered window in full mode only', () => {
    const full = renderHtml(model({ windows: [noPr()] }), 'full')
    expect(full).toContain('<span class="win-number">SECRET-TITLE-XYZ</span>')
    expect(full).not.toContain('class="win-title"')
    const mobile = renderHtml(model({ windows: [noPr()] }), 'mobile')
    expect(mobile).toContain('<span class="win-number">无编号</span>')
    expect(mobile).not.toContain('SECRET-TITLE-XYZ')
  })

  it('keeps the title on its own line for a numbered window in full mode', () => {
    const full = renderHtml(model({ windows: [window({ number: '74' })] }), 'full')
    expect(full).toContain('<span class="win-number">74号</span>')
    expect(full).toContain('<div class="win-title">SECRET-TITLE-XYZ</div>')
  })
})
