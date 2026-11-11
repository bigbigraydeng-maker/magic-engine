import { createBlankItinerary, type TailorMadeItinerary } from './types'

/**
 * CTS 产品册里的 SIC-04「长城一日游」（慕田峪）。
 *
 * 内容照产品册英文原文整理。**刻意不带**价格、每日出发、儿童价这类会变的信息：
 * 价格和出发安排以顾问发出的邮件为准，写进行程单就会过期。
 * 封面不用手填 —— 路线里的 Mutianyu Great Wall 会命中 hero-rules 的长城图。
 */
export function buildGreatWallSic(quoteRef: string): TailorMadeItinerary {
  const base = createBlankItinerary(quoteRef)

  return {
    ...base,
    trip: {
      ...base.trip,
      productType: 'sic',
      title: 'Great Wall Tour',
      route: ['Mutianyu Great Wall'],
      dateRange: '',
      duration: '8 hours',
      heroImage: '',
      summary:
        'Mutianyu offers a different Great Wall experience compared to the popular Badaling section. ' +
        'This part of China’s ancient engineering marvel provides an optional cable car ride, ' +
        'or you can choose to climb more than 1,400 steps to reach the top.',
      highlights: ['Mutianyu Great Wall', 'Chinese style lunch'],
      facts: [
        { label: 'Product code', value: 'SIC-04' },
        { label: 'Duration', value: '8 hours' },
        { label: 'Pick-up', value: 'From your hotel, 07:00 – 08:00' },
        { label: 'Guiding', value: 'English-speaking tour guide' },
        { label: 'On the ground', value: 'Air-conditioned coach or mini-van with a professional driver' },
        { label: 'Lunch', value: 'Chinese style lunch included' },
      ],
    },
    days: [
      {
        day: 1,
        date: '',
        weekday: '',
        route: 'Mutianyu Great Wall',
        body:
          'The Mutianyu Great Wall is much steeper than the Badaling Great Wall, making it a more challenging climb. ' +
          'This section is older than Badaling and features outer and inner parapets. ' +
          'The 2,250-meter-long Mutianyu Great Wall has 22 watchtowers, with the highest one standing 540 meters above sea level. ' +
          'It is also surrounded by woodlands and streams. ' +
          'The Great Wall takes on different appearances in different seasons. In spring, flowers are in full bloom; ' +
          'in summer, it is lush and green; in winter, it is covered with white snow. ' +
          'However, the most charming season for the Great Wall is autumn, when fruits ripen and leaves of various gorgeous colors fall, ' +
          'making it a perfect spot for photography. ' +
          'During the day, we will stop at the famous Longdi Jade Factory for shopping, where you can find some beautiful bargains.',
        travel: 'Air-conditioned coach or mini-van with professional driver',
        accommodation: '',
        meals: 'Chinese style lunch',
      },
    ],
    pricing: {
      ...base.pricing,
      basis: 'Per person',
      amount: null,
      amountNote: 'Price confirmed separately — see covering email',
      optional: [],
    },
    inclusions: [
      'Hotel pick-up and drop-off',
      'Air-conditioned coach or mini-van with the professional driver',
      'Transportation tax, tolls, parking fees',
      'English-speaking tour guide',
      'Chinese style lunch',
      'Admission tickets',
    ],
    exclusions: ['Personal expense', 'Tour guide and driver’s gratuity'],
    notes: [],
    nextSteps: [],
  }
}
