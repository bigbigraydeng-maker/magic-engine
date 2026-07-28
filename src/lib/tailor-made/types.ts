/**
 * Tailor-made 行程单数据结构。
 *
 * 这是行程单模板的输入契约 —— 与
 * templates/tailor-made-itinerary/README.md 里的 schema 一一对应。
 * 改这里就必须同步改模板，反之亦然。
 */

export type TailorMadeStatus = 'draft' | 'sent' | 'confirmed' | 'archived';

export interface TailorMadeConsultant {
  name: string;
  title: string;
  phone: string;
  email: string;
}

export interface TailorMadeFact {
  label: string;
  value: string;
}

export interface TailorMadeDay {
  day: number;
  date: string;
  weekday: string;
  /** 卡片主标题：城市名，或 "A → B" */
  route: string;
  body: string;
  /** 以下三项留空则不渲染对应标签 */
  travel?: string;
  accommodation?: string;
  meals?: string;
}

export interface TailorMadePricingLine {
  label: string;
  value: string;
}

export interface TailorMadeNextStep {
  title: string;
  body: string;
}

export interface TailorMadeItinerary {
  meta: {
    quoteRef: string;
    issuedDate: string;
    validUntil?: string;
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
    /** 留空使用模板默认长城图 */
    heroImage: string;
    summary: string;
    highlights: string[];
    facts: TailorMadeFact[];
  };
  days: TailorMadeDay[];
  pricing: {
    basis: string;
    currency: string;
    /** null = 未定价，模板渲染 amountNote */
    amount: number | null;
    amountNote: string;
    optional: TailorMadePricingLine[];
  };
  inclusions: string[];
  exclusions: string[];
  notes: string[];
  nextSteps: TailorMadeNextStep[];
}

/** 数据库一行 */
export interface TailorMadeRecord {
  id: string;
  client_id: string;
  quote_ref: string;
  /** 终端客户称呼 —— 旅行社的客户，即这份行程单要发给的人 */
  end_client_name: string;
  trip_title: string;
  status: TailorMadeStatus;
  payload: TailorMadeItinerary;
  consultant_name: string | null;
  consultant_email: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 列表页用的精简行（不带 payload，避免列表接口传一堆 JSON） */
export type TailorMadeSummary = Omit<TailorMadeRecord, 'payload'>;

export const TAILOR_MADE_STATUS_LABEL: Record<TailorMadeStatus, string> = {
  draft: '草稿',
  sent: '已发送',
  confirmed: '已成交',
  archived: '已归档',
};

/**
 * 新建行程单的初始值。
 *
 * 条款、含/不含、下一步这些每单都一样的内容预填好 —— 顾问改行程，不改样板文字。
 * 但凡涉及价格、酒店、餐食的字段一律留空：宁可空着，也不能让顾问在一份要发给客户的
 * 文件里改一段看起来已经填好的默认值。
 */
export function createBlankItinerary(quoteRef: string): TailorMadeItinerary {
  return {
    meta: {
      quoteRef,
      issuedDate: formatIssuedDate(new Date()),
      consultant: { name: '', title: 'China Travel Specialist', phone: '0800 287 888', email: '' },
    },
    client: { name: '', travellers: '' },
    trip: {
      title: '',
      route: [],
      dateRange: '',
      duration: '',
      heroImage: '',
      summary: '',
      highlights: [],
      facts: [
        { label: 'Duration', value: '' },
        { label: 'Travelling', value: '' },
        { label: 'Accommodation', value: '' },
        { label: 'Guiding', value: '' },
        { label: 'On the ground', value: '' },
        { label: 'Between cities', value: '' },
      ],
    },
    days: [blankDay(1)],
    pricing: {
      basis: 'Land only, per person, based on two people sharing a twin/double room',
      currency: 'NZD',
      amount: null,
      amountNote: 'Quotation issued separately — see covering email',
      optional: [],
    },
    inclusions: [],
    exclusions: [],
    notes: [
      'For itineraries involving train tickets, availability and details can only be confirmed within 15 days prior to departure.',
      'For visits to the Forbidden City, ticket confirmation is only possible within 7 days of the intended visit date.',
      'Final itinerary and pricing are subject to confirmation upon booking.',
    ],
    nextSteps: [
      {
        title: 'Tell us what to adjust',
        body: 'Reply to this itinerary with anything you would like changed — pace, hotels, cities, or the time of year. Revisions are part of the service.',
      },
      {
        title: 'We confirm and hold',
        body: 'Once you are happy, we confirm hotels and rail seats and issue your invoice and booking conditions.',
      },
      {
        title: 'Travel documents',
        body: 'Final documents, guide details and local contact numbers are issued before you depart.',
      },
    ],
  };
}

export function blankDay(day: number): TailorMadeDay {
  return { day, date: '', weekday: '', route: '', body: '', travel: '', accommodation: '', meals: '' };
}

/** 模板里日期是照排的英式写法，如 "27 July 2026" */
export function formatIssuedDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** 报价编号：CTS-<年>-<4 位序号> */
export function buildQuoteRef(year: number, sequence: number): string {
  return `CTS-${year}-${String(sequence).padStart(4, '0')}`;
}

/** 导出文件名：CTS-Thompson-China-Grand-Discovery-20260728.pdf */
export function buildFileName(it: TailorMadeItinerary): string {
  const slug = (s: string) =>
    s.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'itinerary';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `CTS-${slug(it.client.name || 'client')}-${slug(it.trip.title)}-${stamp}`;
}
