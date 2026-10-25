import path from 'node:path';
import type { TailorMadeItinerary } from './types';
import { normaliseItinerary } from './normalise';
import { buildOnePageSummary } from './summary';
import { injectData, loadBrandLogo, loadTemplate } from './template-html';

/**
 * 把一页摘要数据注入 HTML 模板。
 *
 * 与行程单 / 画册同构，复用同一套载入 + 注入机制（见 ./template-html）：
 * 后台预览和顾问 ⌘P 导出的是同一份 HTML。
 *
 * 入参直接收完整行程单（TailorMadeItinerary），裁剪成摘要字段的活交给
 * buildOnePageSummary —— 渲染器只管「怎么排版」，不管「挑哪些字段」。
 */

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'templates',
  'tailor-made-summary',
  'one-pager-template.html'
);

export async function renderOnePagerHtml(data: TailorMadeItinerary): Promise<string> {
  const [template, logo] = await Promise.all([
    loadTemplate(TEMPLATE_PATH, '一页摘要'),
    loadBrandLogo(),
  ]);

  // 归一化放在渲染入口，预览和导出走的是同一条路 —— 见 normalise.ts 顶部注释
  const summary = buildOnePageSummary(normaliseItinerary(data));
  return injectData(template, { ...summary, logo });
}
