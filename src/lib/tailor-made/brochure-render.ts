import path from 'node:path';
import type { TailorMadeBrochure } from './brochure-types';
import { buildCreditLine, HERO_PREFIX } from './brochure-types';
import { loadHeroDataUri } from './hero';
import { injectData, loadBrandLogo, loadTemplate } from './template-html';

/**
 * 把画册数据注入 HTML 模板。
 *
 * 与行程单同构：同一份 HTML 既是后台预览，也是顾问 ⌘P 导出的 PDF。
 *
 * 两件事在这里算好再交给模板，因为它们是数据问题不是版面问题：
 *  - 版权署名行（哪些图需要署名）
 *  - logo（属于客户的品牌资产，不该焊死在共享模板里；见 template-html.ts 的 loadBrandLogo）
 */

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'templates',
  'tailor-made-brochure',
  'brochure-template.html'
);

/**
 * 封面的收件人和报价编号来自报价单本身，不复制进画册 payload —— 顾问改了
 * 客户名只会改一处，两份文件不会出现两个称呼。
 */
export interface BrochureRenderContext {
  /** 封面 "Prepared for" */
  preparedFor: string;
  /** 报价编号，出现在封面和每页页头 */
  quoteRef: string;
}

/**
 * 把 `hero:beijing` 展开成 data URI。
 *
 * 存的是名字、渲染时才读图，所以数据库里一份画册只有几十 KB，而不是十几兆。
 * 读不到就留空 —— 少一张图的稿子仍然能用，报错的预览不能。
 */
async function resolveImages(data: TailorMadeBrochure): Promise<TailorMadeBrochure> {
  const cache = new Map<string, string>();

  const resolve = async (value: string): Promise<string> => {
    if (!value.startsWith(HERO_PREFIX)) return value;
    const name = value.slice(HERO_PREFIX.length);
    if (!cache.has(name)) cache.set(name, (await loadHeroDataUri(name)) ?? '');
    return cache.get(name) ?? '';
  };

  const next = structuredClone(data);
  next.cover.image = await resolve(next.cover.image);
  for (const city of next.cities) {
    city.hero.image = await resolve(city.hero.image);
    for (const block of city.blocks) {
      if ('image' in block) block.image = await resolve(block.image);
    }
  }
  return next;
}

export async function renderBrochureHtml(
  data: TailorMadeBrochure,
  context: BrochureRenderContext
): Promise<string> {
  const [template, logo, resolved] = await Promise.all([
    loadTemplate(TEMPLATE_PATH, '画册'),
    loadBrandLogo(),
    resolveImages(data),
  ]);
  return injectData(template, {
    ...resolved,
    logo,
    preparedFor: context.preparedFor,
    quoteRef: context.quoteRef,
    creditLine: buildCreditLine(data.credits),
  });
}
