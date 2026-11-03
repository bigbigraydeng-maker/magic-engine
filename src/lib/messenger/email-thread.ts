// 邮件线程处理：只保留发件人本次真正输入的新文本，剔除被引用的历史记录。
// 若把引用历史喂给 AI，会把我们自己的营销文案、价格、日期错误归因到客户身上。

// 单行引用标记（规则 2 中除 from: 两段式与换行 on 之外的部分）。
// 注意：这些正则均不带 g 标志，可安全用于 .test()。
export const QUOTE_MARKERS: readonly RegExp[] = [
  /^on\b.*\bwrote:\s*$/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^_{10,}$/,
  /^发件人[:：]/,
  /^在.*(写道|寫道)[:：]\s*$/,
  /^>/,
];

// 换行 on 检测：首行以 on 开头，拼接后续最多 3 行后匹配 "on ... wrote:"。
const ON_START = /^on\b/i;
const ON_WROTE = /^on\b.*\bwrote:\s*$/i;

// Outlook 头部块检测：from: 行 + 后续 3 行内出现 sent/to/date/subject。
const FROM_START = /^from:\s*\S/i;
const HEADER_FIELD = /^(sent|to|date|subject):/i;

// 设备/客户端页脚：这些不是客人写的字，必须剔除。
// 全部锚定整行、大小写不敏感、不带 g 标志（可安全 .test()）。
// "Sent from my ..." 与 "Sent via ..." 额外要求整行不超过 40 字符，
// 避免把 "Sent from my villa in Queenstown next week" 这类正文误删。
const FOOTER_MAX_LEN = 40;
const FOOTER_PATTERNS: readonly RegExp[] = [
  /^sent from my .+$/i,
  /^sent from outlook( for ios| for android| mobile)?$/i,
  /^get outlook for .+$/i,
  /^sent from mail for windows( 1[01])?$/i,
  /^sent via .+$/i,
  /^下载 outlook for .+$/i,
  /^发自我的 i.+$/i,
  /^发自我的.+手机$/,
];

// 判断某行是否开启引用历史（单行规则）。
function isSingleLineMarker(line: string): boolean {
  const trimmed = line.trim();
  return QUOTE_MARKERS.some((re) => re.test(trimmed));
}

// 判断从 index 起是否为 Outlook 头部块。
function isOutlookHeader(lines: readonly string[], index: number): boolean {
  const trimmed = lines[index].trim();
  if (!FROM_START.test(trimmed)) {
    return false;
  }
  const end = Math.min(index + 4, lines.length);
  for (let i = index + 1; i < end; i += 1) {
    if (HEADER_FIELD.test(lines[i].trim())) {
      return true;
    }
  }
  return false;
}

// 判断从 index 起是否为被换行拆开的 "on ... wrote:"。
function isWrappedOn(lines: readonly string[], index: number): boolean {
  const trimmed = lines[index].trim();
  if (!ON_START.test(trimmed)) {
    return false;
  }
  const end = Math.min(index + 4, lines.length);
  const joined = lines
    .slice(index, end)
    .map((l) => l.trim())
    .join(' ');
  return ON_WROTE.test(joined);
}

// 找到最早开启引用历史的行索引；未找到返回 -1。
function findQuoteStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (
      isSingleLineMarker(lines[i]) ||
      // 转发标记也必须在这里切断。两边用同一份 `FORWARD_MARKERS`：
      // 少了这一条，一封 `Begin forwarded message:` 或只用 3 个连字符的转发信，
      // `own` 会把整段转发内容收进去（当成客人自己写的），`forwarded` 再收一份，
      // 同一段话既重复又归错人 —— 正是这个模块要防的那件事。
      isForwardMarker(lines[i]) ||
      isOutlookHeader(lines, i) ||
      isWrappedOn(lines, i)
    ) {
      return i;
    }
  }
  return -1;
}

// 从末尾剔除签名块：最后一条恰为 "--" 或 "-" 的行及其之后全部丢弃。
function stripSignature(lines: readonly string[]): readonly string[] {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '--' || trimmed === '-') {
      return lines.slice(0, i);
    }
  }
  return lines;
}

// 判断某行是否为设备/客户端页脚。
function isFooterLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') {
    return false;
  }
  for (const re of FOOTER_PATTERNS) {
    if (!re.test(trimmed)) {
      continue;
    }
    // "Sent from my ..." / "Sent via ..." 只匹配短行，避免误删正文。
    if (/^sent (from my|via)\b/i.test(trimmed) && trimmed.length > FOOTER_MAX_LEN) {
      continue;
    }
    return true;
  }
  return false;
}

// 剔除所有设备/客户端页脚行。
function stripFooters(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => !isFooterLine(line));
}

// 把连续空行压成一行。比规则里写的「3 行以上」更狠一点是故意的：
// 邮件客户端爱塞空行，留两行空白对模型没有任何信息量。
function collapseBlankLines(lines: readonly string[]): string {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun += 1;
      if (blankRun <= 1) {
        out.push('');
      }
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out.join('\n');
}

// 统计字母数量（含 Unicode 字母）。
function countLetters(text: string): number {
  const matches = text.match(/\p{L}/gu);
  return matches ? matches.length : 0;
}

// 仅返回发件人本次输入的新文本；无法确定时返回空串（绝不回退到引用历史）。
export function newTextOnly(body: string | null | undefined): string {
  if (body == null) {
    return '';
  }
  const normalised = body.replace(/\r\n?/g, '\n');
  if (normalised.trim() === '') {
    return '';
  }

  const lines = normalised.split('\n');
  const start = findQuoteStart(lines);
  const kept = start === -1 ? lines : lines.slice(0, start);

  const withoutSignature = stripSignature(kept);
  const withoutFooters = stripFooters(withoutSignature);
  const collapsed = collapseBlankLines(withoutFooters).trim();

  if (countLetters(collapsed) < 2) {
    return '';
  }
  return collapsed;
}

/** 清洗后的邮件正文：客人自己打的字，和客人转发过来的内容，分开放。 */
export interface CleanedEmailBody {
  /** 发件人本次真正输入的新文本（等于 `newTextOnly` 的结果）。 */
  own: string;
  /** 被转发过来的内容。只有「转发」才填，普通回复的引用历史一律丢弃，这里保持空串。 */
  forwarded: string;
}

// 转发标记：只有这些才开启 forwarded。注意 "Original Message" 是回复，不是转发。
// 全部不带 g 标志，可安全 .test()。
const FORWARD_MARKERS: readonly RegExp[] = [
  /^-{3,}\s*forwarded message\s*-{3,}$/i,
  /^begin forwarded message:\s*$/i,
  /^-{3,}\s*转发(的)?(邮件|消息)\s*-{3,}$/,
];

// 转发块开头的头部字段行，只从块首剔除。
const FORWARD_HEADER =
  /^(from|sent|to|cc|subject|date|发件人|收件人|主题|日期)[:：]/i;

// forwarded 长度上限，调用方有 token 预算。
const FORWARDED_MAX_LEN = 4000;

// 判断某行是否为转发标记。
function isForwardMarker(line: string): boolean {
  const trimmed = line.trim();
  return FORWARD_MARKERS.some((re) => re.test(trimmed));
}

// 找到最早的转发标记行索引；未找到返回 -1。
function findForwardStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (isForwardMarker(lines[i])) {
      return i;
    }
  }
  return -1;
}

// 从转发块开头剔除头部字段行，保留其后的正文。
function stripForwardHeaders(lines: readonly string[]): readonly string[] {
  let i = 0;
  // 跳过块首的空行。
  while (i < lines.length && lines[i].trim() === '') {
    i += 1;
  }
  // 跳过连续的头部字段行。
  while (i < lines.length && FORWARD_HEADER.test(lines[i].trim())) {
    i += 1;
  }
  return lines.slice(i);
}

// 提取转发内容；无转发标记时返回空串。
function extractForwarded(body: string): string {
  const lines = body.split('\n');
  const start = findForwardStart(lines);
  if (start === -1) {
    return '';
  }
  const block = lines.slice(start + 1);
  const withoutHeaders = stripForwardHeaders(block);
  const withoutFooters = stripFooters(withoutHeaders);
  const collapsed = collapseBlankLines(withoutFooters).trim();
  return collapsed.slice(0, FORWARDED_MAX_LEN);
}

// 把邮件正文拆成「客人自己写的」与「客人转发的」两部分。
export function cleanEmailBody(
  body: string | null | undefined,
): CleanedEmailBody {
  const own = newTextOnly(body);
  if (body == null) {
    return { own, forwarded: '' };
  }
  const normalised = body.replace(/\r\n?/g, '\n');
  if (normalised.trim() === '') {
    return { own, forwarded: '' };
  }
  return { own, forwarded: extractForwarded(normalised) };
}
