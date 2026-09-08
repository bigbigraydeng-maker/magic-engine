// 只引纯逻辑那一半：本文件会被客户端的画册编辑器 import，
// 引 ./hero 会把 node:fs 拖进浏览器包，构建直接失败。
import { matchHeroName, pickHeroName } from './hero-rules';
import {
  blankBrochureCity,
  HERO_PREFIX,
  type BrochureCard,
  type BrochureCity,
  type TailorMadeBrochure,
} from './brochure-types';
import type { TailorMadeDay, TailorMadeItinerary } from './types';

/**
 * 从行程单长出一份画册。
 *
 * 顾问打开「画册」标签页时，不该看到一堆空框子等他填 —— 行程单里已经写着
 * 每天去哪、看什么、住哪，画册要的东西那里几乎都有。所以默认就把它排好，
 * 顾问的活变成「改」而不是「写」。
 *
 * 规则：
 *  - 每一天按落脚城市归到对应城市（"Beijing → Xi'an" 归西安，即当晚在哪）
 *  - 每个城市里正文最长的那天升为整版大图页（它通常就是这城的重头戏）
 *  - 其余每天各成一张景点卡片
 *  - 大图按城市自动选（内置图库，见 hero.ts）
 *  - 住几晚按天数算，来去方式取该城第一天/最后一天的 travel
 *
 * 一个字都不编：所有文字都来自行程单原文。行程单里没写的（介绍、亮点）
 * 就留空，让顾问自己写或用「AI 改写」—— 这份东西要发给付费客户，
 * 系统替他脑补出来的句子，他校对时最难发现。
 */

/** 城市名归一化，用来把 "Xi'an"、"XI'AN"、"xian" 认成同一个 */
function norm(s: string): string {
  return s.toLowerCase().replace(/['’\-\s]+/g, '');
}

/**
 * 把每一天归到路线上的某个城市，沿路线顺序单向推进。
 *
 * 不能简单地「day.route 里提到哪个城市就归哪个」——真实行程 CTS-2026-0024
 * 第 1 天是 "Auckland → Shanghai"，而上海在这条 12 城路线里排最后一站。
 * 按提到就算，这天会被归给上海，上海那页于是变成「第 01–27 天」。
 *
 * 所以只认两种情况：这天提到的是**当前城市**（还没走），或是**下一站**（今天到）。
 * 中途转机顺带出现的城市名一概不算。第一站还没到的那些天不归任何城市。
 */
function assignDaysToCities(days: TailorMadeDay[], route: string[]): Map<string, TailorMadeDay[]> {
  const buckets = new Map<string, TailorMadeDay[]>(route.map((c) => [c, []]));
  let cursor = -1; // 还没到第一站

  for (const day of days) {
    const text = norm(day.route ?? '');

    // 今天到下一站？（"Beijing → Xi'an" 当晚住西安，算西安）
    const next = cursor + 1;
    if (next < route.length && text.includes(norm(route[next]))) {
      cursor = next;
    }

    if (cursor < 0) continue; // 出发/转机日，还没进入任何目的地
    buckets.get(route[cursor])?.push(day);
  }
  return buckets;
}

/**
 * 按当天写了什么来配图。
 *
 * 第一版把卡片图一律留空，想着「图片是各家旅行社自己的资产，让顾问配」。
 * 实际打开是十几张空灰块，顾问的第一反应不是「我该配图了」而是「这东西坏了」。
 *
 * 两条规则，都是被真实数据打出来的（CTS-2026-0026）：
 *
 *  1. **不许用到别的城市的照片。** 中转日「Chongqing → Shanghai」的正文里有
 *     "Transfer to Chongqing airport"，按正文匹配会给上海那页配一张重庆的照片。
 *     客人分不清哪张对应哪座城，但会觉得这册子不对劲。
 *
 *  2. **允许跟本城大图重复。** 一度为了避免撞图而留空，结果 11 张卡片空了 8 张 ——
 *     为了躲一个小瑕疵制造了一个大问题。同一座城里重复一张城景，远好过一片空灰块。
 */
function cardImage(day: TailorMadeDay, cityImage: string, otherCityImages: Set<string>): string {
  const matched = matchHeroName(day.body ?? '');
  if (!matched) return cityImage;

  const image = `${HERO_PREFIX}${matched}`;
  // 匹配到的是别的城市的图 —— 宁可用本城的通用照
  if (image !== cityImage && otherCityImages.has(image)) return cityImage;
  return image;
}

function dayCard(day: TailorMadeDay, image: string): BrochureCard {
  return {
    image,
    day: day.day ? `Day ${String(day.day).padStart(2, '0')}` : '',
    title: day.route || '',
    body: day.body || '',
  };
}

/** 该城市的「速览」三行，全部取自行程单，取不到就留空 */
function glanceFor(days: TailorMadeDay[]): BrochureCity['glance'] {
  const nights = Math.max(0, days.length - 1);
  const stay = days.find((d) => d.accommodation)?.accommodation ?? '';
  const arrive = days[0]?.travel ?? '';
  const onward = days[days.length - 1]?.travel ?? '';

  return [
    { label: 'Nights', value: nights > 0 ? `${nights} · ${stay}`.trim().replace(/·\s*$/, '').trim() : stay },
    { label: 'Getting there', value: arrive },
    { label: 'Onward', value: onward },
  ];
}

export function createBrochureFromItinerary(itinerary: TailorMadeItinerary): TailorMadeBrochure {
  const route = itinerary.trip.route.filter((c) => c.trim().length > 0);
  const days = itinerary.days ?? [];

  const buckets = assignDaysToCities(days, route);

  const cities: BrochureCity[] = route.map((name) => {
    const cityDays = buckets.get(name) ?? [];
    const city = blankBrochureCity(name);
    // 图库里没有这个城市就留空，不拿别处的图凑 —— 见 hero.ts matchHeroName
    const byName = matchHeroName(name);
    city.hero.image = byName ? `${HERO_PREFIX}${byName}` : '';

    if (cityDays.length === 0) return city;

    // 本城的通用照（卡片的兜底），以及这条路线上别的城市的照片（用来挡跨城配图）
    const cityImage = city.hero.image;
    const others = otherCityImages(route, name);

    city.days = spanLabel(cityDays);
    city.glance = glanceFor(cityDays);

    // 正文最长的一天当整版大图页 —— 内容最多的那天通常就是这城的重头戏。
    // 优先挑非中转日：整城的大标题写成 "Chongqing → Chengdu" 很怪，
    // 那是「怎么走」，不是「这城是什么」。
    const withBody = cityDays.filter((d) => (d.body ?? '').trim().length > 0);
    const byLength = (a: TailorMadeDay, b: TailorMadeDay) => (b.body?.length ?? 0) - (a.body?.length ?? 0);
    const settled = withBody.filter((d) => !/[→>]/.test(d.route ?? ''));
    const lead = (settled.length > 0 ? settled : withBody).slice().sort(byLength)[0];

    if (lead) {
      // 中转日只好上阵时，标题用城市名，别把箭头搬到大标题上
      city.hero.title = /[→>]/.test(lead.route ?? '') ? name : (lead.route || name);
      city.hero.body = lead.body ?? '';
      city.hero.caption = `${name}${lead.day ? ` · Day ${String(lead.day).padStart(2, '0')}` : ''}`;

      // 大图跟卡片走同一套规则：这天写的是长城就配长城，比一张泛泛的北京城景准。
      // 整版大图是这一页最先被看到的东西，不该退回通用照。
      city.hero.image = cardImage(lead, city.hero.image, others);
    }

    city.blocks = cityDays
      .filter((d) => d !== lead && (d.body ?? '').trim().length > 0)
      .map((d) => dayCard(d, cardImage(d, cityImage, others)));

    return city;
  });

  return {
    cover: {
      image: `${HERO_PREFIX}${pickHeroName(itinerary.trip)}`,
      eyebrow: 'TAILOR-MADE JOURNEY',
      title: itinerary.trip.title,
      cities: route.map((c) => c.toUpperCase()),
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
      // 行程概述行程单里就有，直接拿来；没有就留空，不替顾问编
      intro: itinerary.trip.summary ?? '',
      note: { title: '', body: '' },
    },
    cities,
    closing: {
      eyebrow: 'Next',
      title: 'Ready when you are',
      body: itinerary.nextSteps?.[0]?.body ?? '',
      signOff: 'EXPERIENCE THE REAL ASIA',
    },
    credits: [],
  };
}

/** 这条路线上除了 `self` 之外，每个城市各自的通用照 —— 用来挡住跨城配图 */
function otherCityImages(route: string[], self: string): Set<string> {
  const out = new Set<string>();
  for (const city of route) {
    if (city === self) continue;
    const name = matchHeroName(city);
    if (name) out.add(`${HERO_PREFIX}${name}`);
  }
  return out;
}

/** "DAYS 02 – 05"；只有一天就写 "DAY 02" */
function spanLabel(days: TailorMadeDay[]): string {
  const nums = days.map((d) => d.day).filter((n): n is number => typeof n === 'number');
  if (nums.length === 0) return '';
  const lo = String(Math.min(...nums)).padStart(2, '0');
  const hi = String(Math.max(...nums)).padStart(2, '0');
  return lo === hi ? `DAY ${lo}` : `DAYS ${lo} – ${hi}`;
}
