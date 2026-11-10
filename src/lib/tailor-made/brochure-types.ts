/**
 * Tailor-made 画册数据结构。
 *
 * 画册是行程单的姊妹文档：行程单讲「每天去哪、住哪、多少钱」，
 * 画册讲「这些地方长什么样、为什么值得去」—— 大图 + 英文介绍，
 * 用来让终端客户在掏钱之前先动心。
 *
 * 这是画册模板的输入契约，与
 * templates/tailor-made-brochure/README.md 里的 schema 一一对应。
 * 改这里就必须同步改模板，反之亦然。
 */

import { productEyebrow, type TailorMadeItinerary } from './types';

/**
 * 图片字段可以是三种值：
 *   - `https://…` / `data:…`  —— 顾问自己的图
 *   - `hero:beijing`          —— 内置城市图库（templates/tailor-made-itinerary/heroes/）
 *   - 空字符串                —— 不出图
 *
 * 内置图存名字而不是图本身：一份画册十几个城市，每张 data URI 约 200KB，
 * 直接塞进 jsonb 会让一行记录涨到几兆，之后每次读写都要付这个代价。
 * 名字在渲染时才展开成 data URI，见 brochure-render.ts。
 */
export const HERO_PREFIX = 'hero:';

/** 一张景点卡片：一张图 + 标题 + 一段英文介绍 */
export interface BrochureCard {
  /** 见 HERO_PREFIX 说明；留空则该卡片只出文字 */
  image: string;
  /** 角标，如 "Day 04"；留空不渲染 */
  day: string;
  title: string;
  body: string;
}

/**
 * 一段纯文字面板（米色底），没有图。
 *
 * 存在的理由是版面而不是内容：一页排 4 张卡片，某个城市只有 3 个景点时
 * 右下角会空一格。与其留个洞，不如放一段「本城注意事项」——
 * 顾问真的有话要说（几月份多冷、要不要带护照），客户也真的会看。
 */
export interface BrochureNote {
  eyebrow: string;
  title: string;
  body: string;
}

export type BrochureBlock = BrochureCard | BrochureNote;

export function isBrochureCard(block: BrochureBlock): block is BrochureCard {
  return 'image' in block;
}

/** 「速览」一行：住几晚 / 怎么来 / 怎么走 */
export interface BrochureGlance {
  label: string;
  value: string;
}

export interface BrochureCity {
  /** 城市名，做整页大标题 */
  name: string;
  /** 天数带，如 "DAYS 02 – 05" */
  days: string;
  /** 开篇整版大图 + 它的介绍 */
  hero: {
    image: string;
    /** 大图讲的那个景点名，如 "The Great Wall at Mutianyu" */
    title: string;
    /** 图片右下角小字说明 */
    caption: string;
    body: string;
  };
  glance: BrochureGlance[];
  /** 该城市的景点卡片与文字面板，按顺序排；分页由模板自动完成 */
  blocks: BrochureBlock[];
}

export interface TailorMadeBrochure {
  /** 封面 */
  cover: {
    image: string;
    /** 上方压在图上的小字，如 "TAILOR-MADE JOURNEY" */
    eyebrow: string;
    title: string;
    /** 封面城市带 */
    cities: string[];
    /** 三栏事实，与行程单封面同构 */
    meta: BrochureGlance[];
    footNote: string;
  };
  /** 总览页 */
  overview: {
    eyebrow: string;
    title: string;
    intro: string;
    note: { title: string; body: string };
  };
  cities: BrochureCity[];
  /** 结尾页 */
  closing: {
    eyebrow: string;
    title: string;
    body: string;
    signOff: string;
  };
  /**
   * 图片版权行。画册里会用到 Wikimedia 等来源的 CC 授权图，
   * 这些许可要求署名 —— 这是要发给付费客户的文件，漏署名是违约不是瑕疵。
   * 每条形如 { author: 'David290', license: 'CC BY-SA 4.0' }。
   */
  credits: { author: string; license: string }[];
}

/** 数据库那一行上的画册字段：没做过画册就是 null */
export type BrochureColumn = TailorMadeBrochure | null;

/**
 * 从行程单派生一份空白画册。
 *
 * 客户名、报价号、城市、日期全部继承 —— 顾问已经在行程单里填过一遍了，
 * 让他再填一遍不只是浪费时间，更会让两份文件的城市顺序对不上，
 * 而终端客户会同时收到这两份文件。
 *
 * 只继承结构，不编造内容：每个城市的介绍文字一律留空，等顾问自己写或从素材库选。
 */
export function createBlankBrochure(itinerary: TailorMadeItinerary): TailorMadeBrochure {
  const route = itinerary.trip.route.filter((city) => city.trim().length > 0);

  return {
    cover: {
      image: '',
      eyebrow: productEyebrow(itinerary.trip.productType).toUpperCase(),
      title: itinerary.trip.title,
      cities: route.map((city) => city.toUpperCase()),
      meta: [
        { label: 'ITINERARY', value: itinerary.trip.title },
        { label: 'DEPARTS', value: itinerary.trip.dateRange },
        { label: 'TRAVELLING', value: itinerary.client.travellers },
      ],
      footNote: 'A companion to your itinerary',
    },
    overview: {
      eyebrow: 'Your journey',
      title: itinerary.trip.title,
      intro: '',
      note: { title: '', body: '' },
    },
    cities: route.map((city) => blankBrochureCity(city)),
    closing: {
      eyebrow: 'Next',
      title: 'Ready when you are',
      body: '',
      signOff: 'EXPERIENCE THE REAL ASIA',
    },
    credits: [],
  };
}

export function blankBrochureCity(name: string): BrochureCity {
  return {
    name,
    days: '',
    hero: { image: '', title: '', caption: '', body: '' },
    glance: [
      { label: 'Nights', value: '' },
      { label: 'Getting there', value: '' },
      { label: 'Onward', value: '' },
    ],
    blocks: [],
  };
}

export function blankBrochureCard(): BrochureCard {
  return { image: '', day: '', title: '', body: '' };
}

export function blankBrochureNote(): BrochureNote {
  return { eyebrow: '', title: '', body: '' };
}

/**
 * 画册的版权署名行。
 *
 * 与模板里的渲染保持一致：模板只负责排版，署名文本在这里生成，
 * 因为「哪些图需要署名」是数据问题不是版面问题。
 */
export function buildCreditLine(credits: TailorMadeBrochure['credits']): string {
  const names: string[] = [];
  for (const credit of credits) {
    const author = credit.author.trim();
    if (author && !names.includes(author)) names.push(author);
  }
  if (names.length === 0) return '';

  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    `Photography: with images by ${list}, used under Creative Commons licences ` +
    'via Wikimedia Commons. Full licence details available on request.'
  );
}

/** 导出文件名：CTS-Thompson-China-Grand-Discovery-picture-book-20260830.pdf */
export function buildBrochureFileName(itinerary: TailorMadeItinerary): string {
  const slug = (s: string) =>
    s.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'brochure';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `CTS-${slug(itinerary.client.name || 'client')}-${slug(itinerary.trip.title)}-picture-book-${stamp}`;
}
