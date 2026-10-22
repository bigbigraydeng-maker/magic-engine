import type { TailorMadeConsultant, TailorMadeFact, TailorMadeItinerary } from './types';

/**
 * 一页摘要（one-page summary）的数据契约。
 *
 * 这不是另一份要顾问填的文档——是从已经写好的行程单（TailorMadeItinerary）里
 * 挑出「发给终端客户 / 旅行社同行第一眼要看的那几行」：这是谁的行程、哪天走、
 * 大概多少钱、几个最抓人的亮点。逐日细节、航班、条款都不在这里——那是行程单
 * 本体的事，这份摘要只用来快速分享判断，不是详细行程单的替代品。
 *
 * 字段名刻意跟行程单保持一致、刻意不带任何客户专属措辞，
 * 这样换一个用 tailor-made 页面的旅游客户也能直接复用这份契约和渲染管线，
 * 只需要换一份品牌模板（见 ../../../templates/tailor-made-summary）。
 */
export interface OnePageSummaryData {
  meta: {
    quoteRef: string;
    issuedDate: string;
    consultant: TailorMadeConsultant;
  };
  client: {
    name: string;
    travellers: string;
  };
  trip: {
    title: string;
    route: string[];
    dateRange: string;
    duration: string;
    summary: string;
    highlights: string[];
    facts: TailorMadeFact[];
  };
  pricing: {
    basis: string;
    currency: string;
    /** null = 未定价，模板渲染 amountNote */
    amount: number | null;
    amountNote: string;
  };
}

/** 亮点最多展示这么多条——一页纸放不下整份清单，放太多等于没有重点 */
export const MAX_SUMMARY_HIGHLIGHTS = 6;

/** 概述超过这个长度就按词边界截断，避免挤掉价格区块（一页纸版面固定，装不下就是截断，不是压缩字体到看不清） */
export const MAX_SUMMARY_CHARS = 320;

/** 在词边界截断，而不是硬切在单词中间 */
function truncateAtWord(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}…`;
}

/**
 * 从完整行程单派生一页摘要。
 *
 * 只挑字段、裁数量，绝不编造——没有的内容留空，由模板按「留空不渲染」处理，
 * 跟行程单模板同一套约定（见 normalise.ts 顶部注释）。
 */
export function buildOnePageSummary(itinerary: TailorMadeItinerary): OnePageSummaryData {
  return {
    meta: {
      quoteRef: itinerary.meta.quoteRef,
      issuedDate: itinerary.meta.issuedDate,
      consultant: itinerary.meta.consultant,
    },
    client: {
      name: itinerary.client.name,
      travellers: itinerary.client.travellers,
    },
    trip: {
      title: itinerary.trip.title,
      route: itinerary.trip.route,
      dateRange: itinerary.trip.dateRange,
      duration: itinerary.trip.duration,
      summary: truncateAtWord(itinerary.trip.summary, MAX_SUMMARY_CHARS),
      highlights: itinerary.trip.highlights.slice(0, MAX_SUMMARY_HIGHLIGHTS),
      facts: itinerary.trip.facts,
    },
    pricing: {
      basis: itinerary.pricing.basis,
      currency: itinerary.pricing.currency,
      amount: itinerary.pricing.amount,
      amountNote: itinerary.pricing.amountNote,
    },
  };
}
