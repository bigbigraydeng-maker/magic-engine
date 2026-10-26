// 只读 dev-console 快照的纯渲染器：把快照模型渲染成一个自包含的 HTML 字符串。
// 不碰文件、不碰网络、不读时钟、不读 process.env。
// 两种模式：'full'（PM 自己的 Mac）和 'mobile'（发布到私有页面，不能泄露窗口标题、分支名、文件路径）。
// 风格与 snapshot-core.mjs 保持一致：ESM、具名导出、JSDoc 类型、2 空格缩进、无分号、单引号。

export const DOT_SYMBOLS = { ok: '●', warn: '◐', bad: '×', none: '—' }

const DOT_LABELS = { opened: '开PR', merged: '已合并', verified: '验过' }
const DOT_KEYS = ['opened', 'merged', 'verified']

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
 * 渲染一个状态灯。
 * @param {string} key 'opened' | 'merged' | 'verified'
 * @param {'ok'|'warn'|'bad'|'none'} state
 * @returns {string}
 */
function renderDot(key, state) {
  const safeState = state === 'ok' || state === 'warn' || state === 'bad' ? state : 'none'
  const label = DOT_LABELS[key]
  const symbol = DOT_SYMBOLS[safeState]
  return `<span class="dot dot-${safeState}" aria-label="${escapeHtml(label)}：${escapeHtml(safeState)}">${escapeHtml(symbol)}</span>`
}

/**
 * 渲染一个窗口行。
 * @param {{ number: string|null, group: string, title: string, branch: string, risk: string, prNumber: number|null, lastActivityAt: string, dots: { opened: string, merged: string, verified: string } }} win
 * @param {boolean} full
 * @returns {string}
 */
function renderWindow(win, full) {
  const numberText = win.number === null || win.number === undefined ? '无编号' : `${win.number}号`
  const prText = win.prNumber === null || win.prNumber === undefined ? '' : `PR#${win.prNumber}`
  const dots = DOT_KEYS.map((key) => {
    const state = win.dots && win.dots[key] ? win.dots[key] : 'none'
    return `<span class="dot-cell">${renderDot(key, state)}<span class="dot-label">${escapeHtml(DOT_LABELS[key])}</span></span>`
  }).join('')

  const extra = full
    ? `<div class="win-extra"><span class="win-title">${escapeHtml(win.title)}</span><span class="win-branch">${escapeHtml(win.branch)}</span></div>`
    : ''

  return [
    '<div class="win">',
    `<div class="win-head"><span class="win-number">${escapeHtml(numberText)}</span>`,
    `<span class="win-risk">风险${escapeHtml(win.risk)}</span>`,
    `<span class="win-pr">${escapeHtml(prText)}</span>`,
    `<span class="win-time">${escapeHtml(formatNz(win.lastActivityAt))}</span></div>`,
    `<div class="win-dots">${dots}</div>`,
    extra,
    '</div>',
  ].join('')
}

/**
 * 渲染窗口区，按 group 分组，组顺序按首次出现。
 * @param {Array<{ number: string|null, group: string, title: string, branch: string, risk: string, prNumber: number|null, lastActivityAt: string, dots: { opened: string, merged: string, verified: string } }>} windows
 * @param {boolean} full
 * @returns {string}
 */
function renderWindows(windows, full) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return '<p class="empty">最近 3 天没有活跃窗口</p>'
  }
  const order = []
  const byGroup = new Map()
  for (const win of windows) {
    const group = win.group
    if (!byGroup.has(group)) {
      byGroup.set(group, [])
      order.push(group)
    }
    byGroup.get(group).push(win)
  }
  return order
    .map((group) => {
      const rows = byGroup.get(group).map((win) => renderWindow(win, full)).join('')
      return `<h2>${escapeHtml(group)}</h2>${rows}`
    })
    .join('')
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

/**
 * 渲染撞车区。
 * @param {Array<{ file: string, prs: Array<{ number: number, headRefName: string, window: string|null }> }>} collisions
 * @param {boolean} full
 * @returns {string}
 */
function renderCollisions(collisions, full) {
  if (!Array.isArray(collisions) || collisions.length === 0) {
    return '<p class="empty">没有撞车</p>'
  }
  return collisions
    .map((collision) => {
      const prs = Array.isArray(collision.prs) ? collision.prs : []
      if (full) {
        const prLines = prs
          .map((pr) => {
            const windowText = windowLabel(pr.window)
            return `<li>PR#${escapeHtml(pr.number)}${escapeHtml(windowText)} <span class="collision-branch">${escapeHtml(pr.headRefName)}</span></li>`
          })
          .join('')
        return `<div class="collision"><div class="collision-file">${escapeHtml(collision.file)}</div><ul>${prLines}</ul></div>`
      }
      const prText = prs
        .map((pr) => {
          const windowText = windowLabel(pr.window)
          return `PR#${escapeHtml(pr.number)}${escapeHtml(windowText)}`
        })
        .join('、')
      return `<div class="collision"><div class="collision-summary">${escapeHtml(prs.length)} 个 PR 改同一个文件：${prText}</div></div>`
    })
    .join('')
}

/**
 * 渲染建议归档区，最多 20 行。
 * @param {Array<{ id: string, number: string|null, group: string, lastActivityAt: string }>} suggestions
 * @returns {string}
 */
function renderArchive(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return '<p class="empty">没有</p>'
  }
  const shown = suggestions.slice(0, 20)
  const rows = shown
    .map((item) => {
      const numberText = item.number === null || item.number === undefined ? '无编号' : `${item.number}号`
      return `<li><span class="archive-number">${escapeHtml(numberText)}</span> <span class="archive-group">${escapeHtml(item.group)}</span> <span class="archive-time">${escapeHtml(formatNz(item.lastActivityAt))}</span></li>`
    })
    .join('')
  const more = suggestions.length > 20 ? `<p class="more">…还有 ${escapeHtml(suggestions.length - 20)} 个</p>` : ''
  return `<ul class="archive">${rows}</ul>${more}`
}

/**
 * 渲染 Grok 的活。只有数字，没有标题和分支名，两种模式都一样。
 * @param {{ openCount: number, openPrs: Array<{ number: number, idleDays: number|null, isDraft: boolean }>, oldestIdleDays: number|null, mergedRecent: number, closedRecent: number, days: number }|undefined} grok
 * @returns {string}
 */
function renderGrok(grok) {
  if (!grok || typeof grok !== 'object') {
    return '<p class="empty">Grok 这一栏没有数据</p>'
  }
  const openCount = grok.openCount
  const oldestIdleDays = grok.oldestIdleDays
  const days = grok.days
  const mergedRecent = grok.mergedRecent
  const closedRecent = grok.closedRecent
  const oldestText = typeof oldestIdleDays === 'number' ? `，最久的 ${escapeHtml(oldestIdleDays)} 天没动` : ''
  const summary = `<p class="meta">还开着 ${escapeHtml(openCount)} 个${oldestText}；最近 ${escapeHtml(days)} 天合了 ${escapeHtml(mergedRecent)} 个，关掉没合的 ${escapeHtml(closedRecent)} 个</p>`

  const openPrs = Array.isArray(grok.openPrs) ? grok.openPrs : []
  if (openPrs.length === 0) return summary

  const shown = openPrs.slice(0, 10)
  const rows = shown
    .map((pr) => {
      const idleText = pr.idleDays === null || pr.idleDays === undefined ? '时间未知' : `${pr.idleDays} 天没动`
      const draftText = pr.isDraft ? ' 草稿' : ''
      return `<li>PR#${escapeHtml(pr.number)}（${escapeHtml(idleText)}）${escapeHtml(draftText)}</li>`
    })
    .join('')
  const more = openPrs.length > 10 ? `<p class="more">…还有 ${escapeHtml(openPrs.length - 10)} 个</p>` : ''
  return `${summary}<ul class="grok">${rows}</ul>${more}`
}

/**
 * 渲染错误横幅。
 * @param {string[]} errors
 * @returns {string}
 */
function renderErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return ''
  const items = errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')
  return `<div class="banner-error"><p>有数据没取到，下面的数字可能不全：</p><ul>${items}</ul></div>`
}

const STYLE = `
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #666666;
  --border: #dddddd;
  --card: #f7f7f7;
  --ok: #1a7f37;
  --warn: #b26a00;
  --bad: #c62828;
  --none: #999999;
  --error-bg: #fdecea;
  --error-fg: #8a1c1c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121212;
    --fg: #e8e8e8;
    --muted: #a0a0a0;
    --border: #333333;
    --card: #1e1e1e;
    --ok: #4ade80;
    --warn: #fbbf24;
    --bad: #f87171;
    --none: #777777;
    --error-bg: #3a1a1a;
    --error-fg: #ffb4b4;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 16px;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 20px 0 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
p { margin: 4px 0; }
ul { margin: 4px 0; padding-left: 20px; }
.meta { color: var(--muted); font-size: 13px; }
.banner-error {
  background: var(--error-bg);
  color: var(--error-fg);
  border: 1px solid var(--error-fg);
  border-radius: 6px;
  padding: 8px 12px;
  margin: 12px 0;
}
.banner-error p { font-weight: 600; }
.win {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 8px 0;
}
.win-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.win-number { font-weight: 600; }
.win-risk, .win-pr, .win-time { color: var(--muted); font-size: 13px; }
.win-dots { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; }
.dot-cell { display: inline-flex; align-items: center; gap: 4px; }
.dot { font-size: 16px; line-height: 1; }
.dot-label { font-size: 12px; color: var(--muted); }
.dot-ok { color: var(--ok); }
.dot-warn { color: var(--warn); }
.dot-bad { color: var(--bad); }
.dot-none { color: var(--none); }
.win-extra { margin-top: 6px; font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px; }
.win-title { color: var(--fg); }
.win-branch { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.collision { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
.collision-file { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.collision-branch { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
.collision-summary { font-size: 14px; }
.archive { list-style: none; padding-left: 0; }
.archive li { padding: 4px 0; border-bottom: 1px solid var(--border); }
.archive-number { font-weight: 600; }
.archive-group { color: var(--muted); }
.archive-time { color: var(--muted); font-size: 13px; }
.empty { color: var(--muted); }
.more { color: var(--muted); font-size: 13px; }
`

/**
 * 把快照模型渲染成一个完整的 HTML 文档字符串。
 * mode 只认 'full'，其余一律按 'mobile'（安全的那一个）处理。
 * @param {{
 *   generatedAt: string,
 *   windows: Array<{ number: string|null, group: string, title: string, branch: string, risk: 'A'|'B'|'C'|'?', prNumber: number|null, lastActivityAt: string, dots: { opened: 'ok'|'warn'|'bad'|'none', merged: 'ok'|'warn'|'bad'|'none', verified: 'ok'|'warn'|'bad'|'none' } }>,
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

  const head = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>开发总控台</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
  ].join('')

  const header = [
    '<h1>开发总控台</h1>',
    `<p class="meta">生成于 ${escapeHtml(formatNz(safeModel.generatedAt))}（新西兰时间）</p>`,
  ].join('')

  const body = [
    renderErrors(errors),
    '<h2>窗口</h2>',
    renderWindows(windows, full),
    `<p class="meta">另有 ${escapeHtml(inactiveCount)} 个不活跃窗口（3 天内没动，不显示）</p>`,
    '<h2>撞车</h2>',
    renderCollisions(collisions, full),
    otherCollisions > 0 ? `<p class="meta">另有 ${escapeHtml(otherCollisions)} 处撞车只发生在不活跃窗口的 PR 之间，不显示</p>` : '',
    '<h2>Grok 的活</h2>',
    renderGrok(safeModel.grok),
    '<h2>建议归档（PR 已合并、3 天没动）</h2>',
    renderArchive(archiveSuggestions),
  ].join('')

  return `${head}${header}${body}</body></html>`
}
