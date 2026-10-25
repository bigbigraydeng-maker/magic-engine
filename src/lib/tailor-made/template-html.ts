import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 自包含 HTML 模板的载入与数据注入。
 *
 * 行程单、画册、一页摘要用同一套机制：模板是一份完整的 A4 HTML，数据以 JSON 字面量
 * 注入到 `/*__DATA_START__*\/ … /*__DATA_END__*\/` 之间，模板内的 JS 负责排版分页。
 * 后台预览和最终 PDF 用的是同一个文件 —— 所见即所得。
 *
 * 抽出来共用，是因为下面那三行转义是安全相关的：JSON 落在 <script> 里，
 * 一个没转义的 `</script>` 就能提前关闭脚本标签、把后面的内容当 HTML 执行。
 * 顾问填的字段（客户名、景点介绍）是可以包含任意文本的，各写一份迟早会漏一处。
 */

const START = '/*__DATA_START__*/';
const END = '/*__DATA_END__*/';

const cache = new Map<string, string>();

export async function loadTemplate(templatePath: string, label: string): Promise<string> {
  const hit = cache.get(templatePath);
  if (hit) return hit;

  let html: string;
  try {
    html = await readFile(templatePath, 'utf8');
  } catch {
    throw new Error(`${label}模板缺失：${templatePath}`);
  }

  if (!html.includes(START) || !html.includes(END)) {
    throw new Error(`${label}模板缺少数据标记（__DATA_START__ / __DATA_END__）`);
  }

  cache.set(templatePath, html);
  return html;
}

/**
 * 把数据注入模板的数据标记之间。
 *
 * `</script>` 与 U+2028/2029 会截断脚本，必须转义。
 */
export function injectData(template: string, data: unknown): string {
  const a = template.indexOf(START);
  const b = template.indexOf(END);

  const json = JSON.stringify(data)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return template.slice(0, a + START.length) + json + template.slice(b);
}

const BRAND_ASSETS_PATH = path.join(process.cwd(), 'templates', 'shared', 'cts-brand-assets.json');

let cachedLogo: string | null = null;

/**
 * 读共享品牌资产里的 logo（目前只有一份 —— CTS）。
 *
 * 提出来给画册、一页摘要等每个渲染器共用，而不是各自读一遍同一个 JSON、
 * 各自维护一份缓存变量。logo 属于客户的品牌资产，不焊死在共享模板里，
 * 由渲染时注入（见 brochure-render.ts / summary-render.ts）。
 */
export async function loadBrandLogo(): Promise<string> {
  if (cachedLogo !== null) return cachedLogo;
  try {
    const raw = await readFile(BRAND_ASSETS_PATH, 'utf8');
    cachedLogo = (JSON.parse(raw) as { logo?: string }).logo ?? '';
  } catch {
    // 缺 logo 不该让整份文档出不来 —— 顾问宁可拿到一份没 logo 的稿子，
    // 也好过点了预览只看到一个报错。
    cachedLogo = '';
  }
  return cachedLogo;
}
