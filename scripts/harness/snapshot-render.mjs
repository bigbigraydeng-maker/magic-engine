// 只读 dev-console 快照的纯渲染器：把快照模型渲染成一个自包含的 HTML 字符串。
// 不碰文件、不碰网络、不读时钟、不读 process.env。
// 两种模式：'full'（PM 自己的 Mac）和 'mobile'（发到手机，不能泄露窗口标题、分支名、文件路径）。
// 风格与 snapshot-core.mjs 保持一致：ESM、具名导出、JSDoc 类型、2 空格缩进、无分号、单引号。

export const DOT_SYMBOLS = { ok: '●', warn: '◐', bad: '×', none: '—' }

const DOT_LABELS = { opened: '开PR', merged: '已合并', verified: '验过' }
const DOT_KEYS = ['opened', 'merged', 'verified']
const ATTENTION_IDLE_DAYS = 3
const ARCHIVE_LIMIT = 20
const GROK_LIMIT = 10
const ID_LIST_LIMIT = 8
const PENDING_LABEL = '已合并·待验证'

/**
 * 转义 HTML 特殊字符。非字符串用 String() 转换，null/undefined 返回空串。
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return ''
  const str = typeof text === 'string' ? text : String(text)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 把 ISO 时间格式化成新西兰时区的 'MM-DD HH:mm'。解析失败返回 '时间未知'。
 * @param {string} iso
 * @returns {string}
 */
export function formatNz(iso) {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return '时间未知'
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at))
  const pick = (type) => {
    const found = parts.find((part) => part.type === type)
    return found ? found.value : ''
  }
  return `${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`
}

/**
 * 「多久以前」：不到 1 分钟写刚刚，不到 1 小时写分钟，不到 1 天写小时，其余写天。解析失败返回 '时间未知'。
 * @param {string} iso
 * @param {string} nowIso
 * @returns {string}
 */
export function formatAgo(iso, nowIso) {
  const at = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(at) || !Number.isFinite(now)) return '时间未知'
  const minutes = Math.max(0, Math.floor((now - at) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * 一句人话的窗口状态。tone：ok / warn / bad / info / none。
 * @param {{ prNumber?: number|null, prState?: string|null, dots?: { opened?: string, merged?: string, verified?: string } }} win
 * @returns {{ label: string, tone: 'ok'|'warn'|'bad'|'info'|'none' }}
 */
export function windowStatus(win) {
  const dots = (win && win.dots) || {}
  const hasPr = win && win.prNumber !== null && win.prNumber !== undefined
  if (!hasPr) return { label: '还没开 PR', tone: 'none' }
  if (win.prState === 'MERGED') {
    if (dots.verified === 'bad') return { label: '验证失败', tone: 'bad' }
    if (dots.verified === 'warn') return { label: PENDING_LABEL, tone: 'warn' }
    if (dots.verified === 'ok') return { label: '已合并·已验证', tone: 'ok' }
    return { label: '已合并', tone: 'ok' }
  }
  if (win.prState === 'CLOSED') return { label: 'PR 已关闭', tone: 'none' }
  if (dots.opened === 'warn') return { label: '检查没过', tone: 'bad' }
  return { label: 'PR 进行中', tone: 'info' }
}

function safeDot(state) {
  return state === 'ok' || state === 'warn' || state === 'bad' ? state : 'none'
}

function windowId(win) {
  if (win.number !== null && win.number !== undefined) return `${win.number}号`
  if (win.prNumber !== null && win.prNumber !== undefined) return `PR#${win.prNumber}`
  return '无编号'
}

/**
 * 撞车里 PR 所属窗口的说法：纯数字写「N号窗口」，'无编号' 写「无编号窗口」，没有窗口返回空串。
 * @param {string|null|undefined} window
 * @returns {string}
 */
function windowLabel(window) {
  if (window === null || window === undefined || window === '') return ''
  return /^\d+$/.test(String(window)) ? `（${window}号窗口）` : `（${window}窗口）`
}

function renderStep(key, state) {
  const safe = safeDot(state)
  const label = DOT_LABELS[key]
  return `<span class="step step-${safe}" aria-label="${escapeHtml(label)}：${escapeHtml(safe)}"><span class="dot dot-${safe}">${escapeHtml(DOT_SYMBOLS[safe])}</span><span class="step-label">${escapeHtml(label)}</span></span>`
}

function renderWindow(win, full, nowIso) {
  const status = windowStatus(win)
  const unnumbered = win.number === null || win.number === undefined
  const numberText = unnumbered ? '无编号' : `${win.number}号`
  const hasPr = win.prNumber !== null && win.prNumber !== undefined
  const prText = hasPr ? `<span class="win-pr">PR#${escapeHtml(win.prNumber)}</span>` : ''
  const riskText = win.risk === '?' ? '' : `<span class="win-risk">风险${escapeHtml(win.risk)}</span>`
  const steps = hasPr ? `<div class="steps">${DOT_KEYS.map((key) => renderStep(key, win.dots && win.dots[key])).join('')}</div>` : ''
  const nameText = full && unnumbered ? win.title : numberText
  const titleLine = full
    ? `${unnumbered ? '' : `<div class="win-title">${escapeHtml(win.title)}</div>`}<div class="win-branch">${escapeHtml(win.branch)}</div>`
    : ''
  return [
    `<div class="win win-${status.tone}">`,
    '<div class="win-main">',
    `<div class="win-head"><span class="win-number">${escapeHtml(nameText)}</span>`,
    `<span class="chip chip-${status.tone}">${escapeHtml(status.label)}</span>`,
    `${riskText}${prText}`,
    `<span class="win-time" title="${escapeHtml(formatNz(win.lastActivityAt))}">${escapeHtml(formatAgo(win.lastActivityAt, nowIso))}</span></div>`,
    titleLine,
    '</div>',
    steps,
    '</div>',
  ].join('')
}

function renderWindows(windows, full, nowIso) {
  if (windows.length === 0) return '<p class="empty">最近 3 天没有活跃窗口</p>'
  const order = []
  const byGroup = new Map()
  for (const win of windows) {
    if (!byGroup.has(win.group)) {
      byGroup.set(win.group, [])
      order.push(win.group)
    }
    byGroup.get(win.group).push(win)
  }
  return order
    .map((group) => {
      const items = byGroup.get(group)
      const rows = items.map((win) => renderWindow(win, full, nowIso)).join('')
      return `<div class="group"><div class="group-head"><h2>${escapeHtml(group)}</h2><span class="count">${escapeHtml(items.length)} 个</span></div>${rows}</div>`
    })
    .join('')
}

function renderCollisions(collisions, full) {
  if (collisions.length === 0) return '<p class="empty">没有撞车</p>'
  return collisions
    .map((collision) => {
      const prs = Array.isArray(collision.prs) ? collision.prs : []
      if (full) {
        const prLines = prs
          .map((pr) => `<li>PR#${escapeHtml(pr.number)}${escapeHtml(windowLabel(pr.window))} <span class="collision-branch">${escapeHtml(pr.headRefName)}</span></li>`)
          .join('')
        return `<div class="collision"><div class="collision-file">${escapeHtml(collision.file)}</div><ul>${prLines}</ul></div>`
      }
      const prText = prs.map((pr) => `PR#${escapeHtml(pr.number)}${escapeHtml(windowLabel(pr.window))}`).join('、')
      return `<div class="collision"><div class="collision-summary">${escapeHtml(prs.length)} 个 PR 改同一个文件：${prText}</div></div>`
    })
    .join('')
}

function renderGrok(grok) {
  if (!grok) return '<p class="empty">Grok 这一栏没有数据</p>'
  const oldestText = typeof grok.oldestIdleDays === 'number' ? `，最久的 ${escapeHtml(grok.oldestIdleDays)} 天没动` : ''
  const summary = `<p class="meta">还开着 ${escapeHtml(grok.openCount)} 个${oldestText}；最近 ${escapeHtml(grok.days)} 天合了 ${escapeHtml(grok.mergedRecent)} 个，关掉没合的 ${escapeHtml(grok.closedRecent)} 个</p>`
  const openPrs = Array.isArray(grok.openPrs) ? grok.openPrs : []
  if (openPrs.length === 0) return summary
  const rows = openPrs
    .slice(0, GROK_LIMIT)
    .map((pr) => {
      const idleText = pr.idleDays === null || pr.idleDays === undefined ? '时间未知' : `${pr.idleDays} 天没动`
      const draftText = pr.isDraft ? ' 草稿' : ''
      return `<li>PR#${escapeHtml(pr.number)}（${escapeHtml(idleText)}）${escapeHtml(draftText)}</li>`
    })
    .join('')
  const more = openPrs.length > GROK_LIMIT ? `<p class="more">…还有 ${escapeHtml(openPrs.length - GROK_LIMIT)} 个</p>` : ''
  return `${summary}<ul class="grok">${rows}</ul>${more}`
}

function renderArchive(suggestions) {
  if (suggestions.length === 0) return '<p class="empty">没有</p>'
  const rows = suggestions
    .slice(0, ARCHIVE_LIMIT)
    .map((item) => {
      const numberText = item.number === null || item.number === undefined ? '无编号' : `${item.number}号`
      return `<li><span class="archive-number">${escapeHtml(numberText)}</span> <span class="archive-group">${escapeHtml(item.group)}</span> <span class="archive-time">${escapeHtml(formatNz(item.lastActivityAt))}</span></li>`
    })
    .join('')
  const more = suggestions.length > ARCHIVE_LIMIT ? `<p class="more">…还有 ${escapeHtml(suggestions.length - ARCHIVE_LIMIT)} 个</p>` : ''
  return `<ul class="archive">${rows}</ul>${more}`
}

function renderErrors(errors) {
  if (errors.length === 0) return ''
  const items = errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')
  return `<div class="banner-error"><p>有数据没取到，下面的数字可能不全：</p><ul>${items}</ul></div>`
}

function idList(items) {
  const shown = items.slice(0, ID_LIST_LIMIT).join('、')
  return items.length > ID_LIST_LIMIT ? `${shown} 等 ${items.length} 个` : shown
}

/**
 * 「要你关注的」：只写数字和编号，不放标题、分支、文件路径。
 * @param {{ windows: object[], collisions: object[], grok?: object|null }} parts
 * @returns {Array<{ tone: 'bad'|'warn', text: string }>}
 */
export function attentionItems({ windows, collisions, grok }) {
  const items = []
  for (const win of windows) {
    const status = windowStatus(win)
    if (status.tone === 'bad') items.push({ tone: 'bad', text: `${windowId(win)}：${status.label}` })
  }
  const pending = windows.filter((win) => windowStatus(win).label === PENDING_LABEL)
  if (pending.length > 0) {
    items.push({ tone: 'warn', text: `${pending.length} 个已合并的窗口，台账还没验完：${idList(pending.map(windowId))}` })
  }
  if (collisions.length > 0) {
    const numbers = collisions.flatMap((collision) => (Array.isArray(collision.prs) ? collision.prs : []).map((pr) => pr.number))
    const unique = [...new Set(numbers)].map((number) => `PR#${number}`)
    items.push({ tone: 'bad', text: `${collisions.length} 处撞车（两个 PR 改同一个文件）：${idList(unique)}` })
  }
  const stale = grok && Array.isArray(grok.openPrs)
    ? grok.openPrs.filter((pr) => typeof pr.idleDays === 'number' && pr.idleDays >= ATTENTION_IDLE_DAYS)
    : []
  if (stale.length > 0) {
    items.push({ tone: 'warn', text: `Grok 有 ${stale.length} 个 PR 超过 ${ATTENTION_IDLE_DAYS} 天没动：${idList(stale.map((pr) => `PR#${pr.number}`))}` })
  }
  return items
}

function renderAttention(items) {
  if (items.length === 0) return '<p class="ok-line">现在没有需要你处理的</p>'
  const rows = items.map((item) => `<li class="attn attn-${item.tone}">${escapeHtml(item.text)}</li>`).join('')
  return `<ul class="attention">${rows}</ul>`
}

function renderTile(value, label, tone) {
  return `<div class="tile tile-${tone}"><div class="tile-value">${escapeHtml(value)}</div><div class="tile-label">${escapeHtml(label)}</div></div>`
}

function renderTiles({ windows, collisions, grok }) {
  const open = windows.filter((win) => win.prState === 'OPEN').length
  const pending = windows.filter((win) => windowStatus(win).label === PENDING_LABEL).length
  const tiles = [
    renderTile(windows.length, '活跃窗口', 'none'),
    renderTile(open, 'PR 进行中', open > 0 ? 'info' : 'none'),
    renderTile(pending, '待验证', pending > 0 ? 'warn' : 'none'),
    renderTile(collisions.length, '撞车', collisions.length > 0 ? 'bad' : 'none'),
  ]
  if (grok) tiles.push(renderTile(grok.openCount, 'Grok 开着', 'none'))
  return `<div class="tiles">${tiles.join('')}</div>`
}

function renderSection(title, content) {
  return `<section><div class="sec-title"><h2>${escapeHtml(title)}</h2></div>${content}</section>`
}

const STYLE = `
:root {
  --bg: #f4f5f8;
  --panel: #ffffff;
  --fg: #151a23;
  --muted: #5d6675;
  --line: #e2e5eb;
  --ok-bg: #e2f4e8; --ok-fg: #16662e;
  --warn-bg: #fcf0d6; --warn-fg: #7f4c00;
  --bad-bg: #fde4e2; --bad-fg: #a21f19;
  --info-bg: #e2ecfb; --info-fg: #1d4f9c;
  --none-bg: #eceef2; --none-fg: #5d6675;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #12151b; --panel: #1b2029; --fg: #e8ebf1; --muted: #9aa3b2; --line: #2b3240;
    --ok-bg: #173826; --ok-fg: #6fd493;
    --warn-bg: #3f2f10; --warn-fg: #f1bd5a;
    --bad-bg: #44201e; --bad-fg: #ff9d95;
    --info-bg: #1b3050; --info-fg: #8db6f5;
    --none-bg: #262d3a; --none-fg: #9aa3b2;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #12151b; --panel: #1b2029; --fg: #e8ebf1; --muted: #9aa3b2; --line: #2b3240;
  --ok-bg: #173826; --ok-fg: #6fd493;
  --warn-bg: #3f2f10; --warn-fg: #f1bd5a;
  --bad-bg: #44201e; --bad-fg: #ff9d95;
  --info-bg: #1b3050; --info-fg: #8db6f5;
  --none-bg: #262d3a; --none-fg: #9aa3b2;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
  padding-block: 20px 40px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
.page { max-width: 960px; margin: 0 auto; }
h1 { font-size: 26px; line-height: 1.2; margin: 0 0 4px; letter-spacing: 0.01em; }
h2 { font-size: 17px; margin: 0; }
.sec-title { margin: 28px 0 10px; }
.sec-title h2 { font-size: 13px; font-weight: 600; letter-spacing: 0.08em; color: var(--muted); }
.meta { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
.empty { color: var(--muted); margin: 6px 0; }
.ok-line { color: var(--ok-fg); background: var(--ok-bg); padding: 12px 14px; border-radius: 10px; font-weight: 600; margin: 0; }
.more { color: var(--muted); font-size: 13px; margin: 4px 0; }
.banner-error { background: var(--bad-bg); color: var(--bad-fg); border-radius: 10px; padding: 12px 14px; margin: 14px 0; font-weight: 600; }
.banner-error p { margin: 0 0 4px; }
.banner-error ul { margin: 0; padding-left: 18px; font-weight: 400; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 16px 0 4px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; min-width: 0; }
.tile-value { font-size: 30px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.tile-label { font-size: 13px; color: var(--muted); margin-top: 2px; }
.tile-info { background: var(--info-bg); border-color: transparent; }
.tile-info .tile-value { color: var(--info-fg); }
.tile-warn { background: var(--warn-bg); border-color: transparent; }
.tile-warn .tile-value { color: var(--warn-fg); }
.tile-bad { background: var(--bad-bg); border-color: transparent; }
.tile-bad .tile-value { color: var(--bad-fg); }
.attention { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.attn { padding: 11px 14px; border-radius: 10px; font-weight: 500; overflow-wrap: anywhere; }
.attn-bad { background: var(--bad-bg); color: var(--bad-fg); }
.attn-warn { background: var(--warn-bg); color: var(--warn-fg); }
.group { margin: 0 0 18px; }
.group-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; padding: 0 2px; }
.count { color: var(--muted); font-size: 13px; }
.win { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--none-fg); border-radius: 10px; padding: 11px 14px; margin: 0 0 8px; }
.win-ok { border-left-color: var(--ok-fg); }
.win-warn { border-left-color: var(--warn-fg); }
.win-bad { border-left-color: var(--bad-fg); }
.win-info { border-left-color: var(--info-fg); }
.win-main { min-width: 0; flex: 1 1 260px; }
.win-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.win-number { font-weight: 700; font-size: 16px; }
.win-risk, .win-pr, .win-time { color: var(--muted); font-size: 13px; }
.win-title { margin-top: 3px; overflow-wrap: anywhere; }
.win-branch, .collision-file, .collision-branch { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); overflow-wrap: anywhere; }
.chip { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.chip-ok { background: var(--ok-bg); color: var(--ok-fg); }
.chip-warn { background: var(--warn-bg); color: var(--warn-fg); }
.chip-bad { background: var(--bad-bg); color: var(--bad-fg); }
.chip-info { background: var(--info-bg); color: var(--info-fg); }
.chip-none { background: var(--none-bg); color: var(--none-fg); }
.steps { display: flex; gap: 6px; flex: 0 0 auto; }
.step { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 8px; font-size: 12px; white-space: nowrap; }
.step-ok { background: var(--ok-bg); color: var(--ok-fg); }
.step-warn { background: var(--warn-bg); color: var(--warn-fg); }
.step-bad { background: var(--bad-bg); color: var(--bad-fg); }
.step-none { background: var(--none-bg); color: var(--none-fg); }
.dot { font-weight: 700; }
.collision { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--bad-fg); border-radius: 10px; padding: 10px 14px; margin: 0 0 8px; }
.collision ul { margin: 6px 0 0; padding-left: 18px; }
.collision-summary { font-weight: 500; }
.grok, .archive { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; margin: 6px 0 0; padding: 10px 14px 10px 32px; }
.archive-group, .archive-time { color: var(--muted); font-size: 13px; margin-left: 6px; }
@media (max-width: 520px) { .steps { width: 100%; } .tile-value { font-size: 26px; } }
`

/**
 * 把快照模型渲染成一个完整的 HTML 文档字符串。
 * mode 只认 'full'，其余一律按 'mobile'（安全的那一个）处理。
 * @param {{
 *   generatedAt: string,
 *   windows: Array<{ number: string|null, group: string, title: string, branch: string, risk: 'A'|'B'|'C'|'?', prNumber: number|null, prState?: string|null, lastActivityAt: string, dots: { opened: 'ok'|'warn'|'bad'|'none', merged: 'ok'|'warn'|'bad'|'none', verified: 'ok'|'warn'|'bad'|'none' } }>,
 *   inactiveCount: number,
 *   collisionsOtherCount?: number,
 *   collisions: Array<{ file: string, prs: Array<{ number: number, headRefName: string, window: string|null }> }>,
 *   grok?: { openCount: number, openPrs: Array<{ number: number, idleDays: number|null, isDraft: boolean }>, oldestIdleDays: number|null, mergedRecent: number, closedRecent: number, days: number },
 *   archiveSuggestions: Array<{ id: string, number: string|null, group: string, lastActivityAt: string }>,
 *   errors: string[]
 * }} model
 * @param {'full'|'mobile'} mode
 * @returns {string}
 */
export function renderHtml(model, mode) {
  const full = mode === 'full'
  const safeModel = model || {}
  const windows = Array.isArray(safeModel.windows) ? safeModel.windows : []
  const collisions = Array.isArray(safeModel.collisions) ? safeModel.collisions : []
  const archiveSuggestions = Array.isArray(safeModel.archiveSuggestions) ? safeModel.archiveSuggestions : []
  const errors = Array.isArray(safeModel.errors) ? safeModel.errors : []
  const inactiveCount = typeof safeModel.inactiveCount === 'number' ? safeModel.inactiveCount : 0
  const otherCollisions = typeof safeModel.collisionsOtherCount === 'number' ? safeModel.collisionsOtherCount : 0
  const grok = safeModel.grok && typeof safeModel.grok === 'object' ? safeModel.grok : null
  const nowIso = safeModel.generatedAt

  const head = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>开发总控台</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body><div class="page">',
  ].join('')

  const header = [
    '<h1>开发总控台</h1>',
    `<p class="meta">生成于 ${escapeHtml(formatNz(nowIso))}（新西兰时间）</p>`,
  ].join('')

  const hiddenCollisions = otherCollisions > 0
    ? `<p class="meta">另有 ${escapeHtml(otherCollisions)} 处撞车只发生在不活跃窗口的 PR 之间，不显示</p>`
    : ''

  const body = [
    renderErrors(errors),
    renderTiles({ windows, collisions, grok }),
    renderSection('要你关注的', renderAttention(attentionItems({ windows, collisions, grok }))),
    renderSection('窗口', `${renderWindows(windows, full, nowIso)}<p class="meta">另有 ${escapeHtml(inactiveCount)} 个不活跃窗口（3 天内没动，不显示）</p>`),
    renderSection('撞车', `${renderCollisions(collisions, full)}${hiddenCollisions}`),
    renderSection('Grok 的活', renderGrok(grok)),
    renderSection('建议归档（PR 已合并、3 天没动）', renderArchive(archiveSuggestions)),
  ].join('')

  return `${head}${header}${body}</div></body></html>`
}
