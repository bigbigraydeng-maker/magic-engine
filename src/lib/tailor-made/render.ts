import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TailorMadeItinerary } from './types';

/**
 * 把行程数据注入 HTML 模板。
 *
 * 模板是唯一的版面来源（templates/tailor-made-itinerary/itinerary-template.html），
 * 后台预览和最终 PDF 用的是同一个文件 —— 所见即所得，不存在两套样式跑偏的问题。
 */

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'templates',
  'tailor-made-itinerary',
  'itinerary-template.html'
);

const START = '/*__DATA_START__*/';
const END = '/*__DATA_END__*/';

let cached: string | null = null;

async function loadTemplate(): Promise<string> {
  if (cached) return cached;

  let html: string;
  try {
    html = await readFile(TEMPLATE_PATH, 'utf8');
  } catch {
    throw new Error(`行程单模板缺失：${TEMPLATE_PATH}`);
  }

  if (!html.includes(START) || !html.includes(END)) {
    throw new Error('行程单模板缺少数据标记（__DATA_START__ / __DATA_END__）');
  }

  cached = html;
  return html;
}

export async function renderItineraryHtml(data: TailorMadeItinerary): Promise<string> {
  const template = await loadTemplate();
  const a = template.indexOf(START);
  const b = template.indexOf(END);

  // 数据落在 <script> 里，`</script>` 与 U+2028/2029 会截断脚本，必须转义
  const json = JSON.stringify(data)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return template.slice(0, a + START.length) + json + template.slice(b);
}
