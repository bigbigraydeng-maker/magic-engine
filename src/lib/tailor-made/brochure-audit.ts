import { isBrochureCard, type TailorMadeBrochure } from './brochure-types';
import type { AuditFinding } from './audit';

/**
 * 撞图体检：同一个城市板块里，两张卡片（或大图）用了同一张图。
 *
 * 来由：CTS-2026-0030 的长江三峡三天，图库当时只有一张三峡照片，
 * 三张卡片全用同一张 —— 客户翻到这三页会觉得像同一张图反复贴。
 * PM 拍板：软提醒（标出来，顾问自己决定要不要照发），不硬挡「标记已发送」——
 * 库存不够时硬挡过，8 张卡片空了 8 张，比撞图更糟（见 brochure-seed.ts assignCardImages）。
 *
 * 只查「同一张图」，不查「长得像但不是同一张图」——那需要真的看懂图片内容，
 * 现在没有这个能力（评估过一次 AI 识图，见 docs/registry/platform-candidates.md
 * 「AI 辅助图片识别打标签」，长尾地标错误率不低，暂缓）。撞图靠这道检查兜底，
 * 「像不像」目前只能靠选图时人工把关（不同景点选不同的内置图）。
 */
export function auditBrochureImages(brochure: TailorMadeBrochure): AuditFinding[] {
  const out: AuditFinding[] = [];

  for (const city of brochure.cities) {
    const usedBy = new Map<string, string[]>();
    const record = (image: string, label: string) => {
      if (!image) return;
      const labels = usedBy.get(image) ?? [];
      labels.push(label);
      usedBy.set(image, labels);
    };

    record(city.hero.image, city.hero.title || '整版大图');
    city.blocks.forEach((block) => {
      if (isBrochureCard(block) && block.image) {
        // 日期比标题更能指哪张卡片——两天写的标题常常一字不差（都叫
        // "Yangtze River — Three Gorges"），只有日期能分清楚是哪一张。
        record(block.image, block.day || block.title || '卡片');
      }
    });

    for (const labels of usedBy.values()) {
      if (labels.length > 1) {
        out.push({
          level: 'warn',
          where: `${city.name || '未命名城市'} · 图片`,
          what: `${labels.join('、')} 用了同一张图，客户翻页时会觉得眼熟`,
        });
      }
    }
  }

  return out;
}

/** 一句话总结，给编辑器标题栏用 */
export function brochureAuditSummary(findings: AuditFinding[]): string {
  if (findings.length === 0) return '没有撞图';
  return `${findings.length} 处撞图`;
}
