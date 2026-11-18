import type { ConfirmationData, ConfirmationTip } from './types'

/**
 * Standard "Travel Tips to China" block copied from the CTS4270729 document.
 * Staff can edit any of it per document; numbering is automatic.
 * Season-specific (weather) and policy-dated (visa) items are the ones to review each time.
 */
export const DEFAULT_TIPS: ConfirmationTip[] = [
  {
    title: 'Electrical Outlets and Voltage',
    body:
      "Voltage: China's standard voltage is 220V, 50Hz, which differs from New Zealand's 230V, 50Hz. Most devices will work fine, but always check your device's voltage range to ensure compatibility.\nPlug Types: China primarily uses two types of plugs: Type A (two flat parallel pins) and Type I (three flat pins in a triangular pattern), which is similar to what is used in New Zealand. However, bringing a universal travel adapter is recommended to accommodate all outlets.",
  },
  {
    title: 'Weather in Late July to Early August',
    body:
      'Season: It is the peak of the midsummer sauna weather.\nThe temperature ranges from 24℃ to 35℃, with sweltering heat and frequent rainfall.\nRecommended clothing: short-sleeved shirts, shorts, thin sun-protective long-sleeve tops, rain gear and sandals. Apply proper sun protection on sunny days and drink plenty of water to stay hydrated.',
  },
  {
    title: 'Health and Safety',
    body: 'Health Insurance: Make sure you have comprehensive travel insurance that covers medical emergencies.',
  },
  {
    title: 'Language',
    body:
      'Language Barrier: While English may be spoken in tourist areas, it’s limited in more remote locations. Learning a few basic Mandarin phrases or having a translation app ready can be very helpful.\nSignage: Major cities will have signs in both Chinese and English, but rural areas may only have Chinese signage.',
  },
  {
    title: 'Currency and Payment Methods',
    body:
      'Currency: The official currency is the Renminbi (RMB), also known as the Yuan (CNY). You can exchange New Zealand dollars at banks, airports, and authorized currency exchange centers in China.\nCredit Cards: International credit cards (Visa, MasterCard) are accepted in major hotels and restaurants, but not everywhere. Mobile payments (Alipay, WeChat Pay) are widely used in China, but they may not be available to foreign tourists without a Chinese bank account.\nCash: It’s a good idea to carry some cash for smaller shops, markets, and taxis.\nMobile Payments: Mobile payment systems like Alipay and WeChat Pay dominate in China. These platforms are used for everything from shopping and dining to transportation and entry fees at attractions.',
  },
  {
    title: 'Internet and Communication',
    body:
      'Internet Access: China has a strict internet censorship policy, so many familiar websites like Google, Facebook, Instagram, and WhatsApp are blocked. To access these services, you will need a VPN before entering China.\nSIM Cards and Mobile Data: You can either purchase a Chinese SIM card upon arrival or buy an international roaming plan before you leave New Zealand. Major Chinese telecom companies like China Mobile, China Unicom, and China Telecom offer tourist SIM cards with data packages.',
  },
  {
    title: 'Time Zone',
    body: 'China Standard Time (CST): China operates in one time zone, which is GMT +8. Keep this in mind when coordinating flights or meeting schedules.',
  },
  {
    title: 'Entry Requirements',
    body:
      'Visa: 30-day visa free for NZ & AU passport.\nChina currently offers 30-day visa-free entry for citizens of New Zealand, Australia, and a number of other eligible countries. This policy is currently valid until the end of 2026.\nIf you are travelling on a passport other than a New Zealand or Australian passport, please check whether you are eligible for visa-free entry to China before you travel.\nIf you require a Chinese visa, please contact us as early as possible so that we can assist you with your visa application. We will provide the necessary supporting travel documents, including your flight itinerary and travel itinerary, to help with your application.\nWe also recommend that your passport has at least six (6) months’ validity remaining from the date of your entry into China to avoid any travel or airline check-in issues.',
  },
  {
    title: 'Cultural Etiquette',
    body:
      'Respect for Customs: China has rich cultural traditions. It’s important to be respectful, particularly in religious sites like temples, and to follow any instructions from local guides.\nTipping: Tipping is not a common practice in China, except for tour guides and hotel staff in more tourist-centric areas, where it may be appreciated but not expected.',
  },
  {
    title: 'Transportation',
    body:
      'Public Transport: China has an extensive and efficient public transport system, including trains, buses, and subways. Major cities like Beijing and Shanghai have metro systems with English signage.\nHigh-Speed Rail: China’s high-speed train network is a great way to travel between cities efficiently. Make sure to book tickets in advance, as trains can be crowded, especially during public holidays.\nTaxis: Taxis are widely available here, and Didi are very popular, though you may need help with the language.',
  },
  {
    title: 'Tap Water for Personal Hygiene',
    body:
      'While tap water in China is not safe for drinking, it is safe enough to use for brushing your teeth, washing your face, and showering. For drinking, it’s recommended to use bottled or boiled water, which is readily available in most hotels and convenience stores.',
  },
  {
    title: 'Power Bank Notice',
    body:
      'For flight safety, power banks carried on domestic flights within China must bear a clear and valid China Compulsory Certification (3C / CCC) mark.\nPower banks are NOT allowed in checked luggage. You may only carry them in your carry-on bag.\nPower banks without the 3C mark, with unclear marks or on the recall list will be confiscated at security check and cannot board the plane.\nPower bank limit: ≤100Wh (allowed); 100–160Wh (airline approval required, max 2 per person); over 160Wh prohibited.\nThis rule also applies if you transfer to a domestic flight after your international arrival in China.',
  },
  {
    title: 'Emergency Contacts',
    body:
      'Emergency Number: The emergency number for police in China is 110, for medical assistance 120, and for fire 119.\nEmbassy: Make sure you have the contact information for the New Zealand Embassy in China in case of any emergencies.\nEmbassy of New Zealand to China\nAddress: No.1, Ri Tan Dong Er Jie, Beijing, China\nTel: +86-10-85327000\nEmail: beijing.enquiries@mft.net.nz',
  },
  {
    title: 'Tipping',
    body:
      'Tipping is not included for land tours. It is recommended to give tips in cash directly to your tour guide and drivers. Please give each city’s guide a tip of 10 NZD per person per day.',
  },
]

/** Index of the Power Bank tip: the 3C-mark photo is printed under it. */
export const POWER_BANK_TIP_TITLE = 'Power Bank Notice'

export function emptyConfirmation(): ConfirmationData {
  return {
    tourCode: '',
    groundOperator: 'China Travel Service-Wuxi Branch',
    operatorTel: '86-510-82302992',
    departureDate: '',
    emergencyContacts: [
      { name: '韩凌云 / Lucy Han', mobile: '008613812182300' },
      { name: '高敏 / Summer Gao', mobile: '008613906197266' },
    ],
    paxCount: 2,
    rooms: 'Twin room per night',
    flights: [{ text: '' }],
    pickupCardNames: '',
    guideNote: 'to be confirmed',
    days: [{ date: '', route: '', highlights: '', overnight: '' }],
    itineraryNote: '',
    hotels: [],
    inclusions: [
      'Daily breakfast as per itinerary',
      'Private airport transfers',
      'English-speaking local guides',
      'Private transport for sightseeing',
      'Entrance fees to listed attractions',
    ],
    exclusions: [
      'International airfare',
      'China visa (if applicable at time of travel)',
      'Travel insurance',
      'Lunches, dinners and personal expenses unless otherwise stated',
      'Tips 15 NZD per person per day for guide and driver',
    ],
    tips: DEFAULT_TIPS.map((t) => ({ ...t })),
  }
}

/** The real CTS4270729 file, for the "load example" button and tests. */
export function sampleConfirmation(): ConfirmationData {
  return {
    ...emptyConfirmation(),
    tourCode: 'CTS4270729',
    departureDate: '29-Jul-2027',
    paxCount: 2,
    flights: [
      { text: 'CA 852Z 28JUL LGWPEK HK2 1235 0545 29JUL' },
      { text: 'CA 783Z 01AUG 7 PEKAKL HK2 0005 1630' },
    ],
    pickupCardNames: 'SAYWELL/MURRAY ALEXANDER\nSAYWELL/JULIE LYNN',
    guideNote: 'Beijing English-speaking guide: to be confirmed',
    days: [
      {
        date: '29 Jul',
        route: 'Arrive Beijing',
        highlights:
          'Flight info: CA 852Z 28JUL LGWPEK 1235 0545 29JUL\nUpon arrival, meet and greet, private transfer to visit the Summer Palace. In the afternoon, transfer to the hotel to have a good rest.',
        overnight: 'Beijing',
      },
      { date: '30 Jul', route: 'Beijing (B)', highlights: 'Tiananmen Square, Forbidden City, Temple of Heaven', overnight: 'Beijing' },
      {
        date: '31 Jul',
        route: 'Beijing Depart (B)',
        highlights:
          'Great Wall of China at Mutianyu Section, and stop at Bird’s Nest and Water Cube (outside). Transfer to the airport exit.\nFlight info: CA 783Z 01AUG 7 PEKAKL 0005 1630',
        overnight: '',
      },
    ],
    itineraryNote:
      'Tickets for the Forbidden City are limited daily and entrance is not guaranteed; admission depends on ticket availability. If tickets cannot be obtained, the itinerary will be changed to visiting Jingshan Park for an overview of the Forbidden City and Prince Gong’s Mansion.',
    hotels: [
      {
        city: 'Beijing',
        name: 'Wanda Moments Beijing Dongba',
        stars: 4,
        address: 'Building 2, Yard 99, Hejing Road, Dongba Township, Chaoyang District, Beijing',
        phone: '+86-10-89101888',
        chinese: '北京东坝万达美华酒店\n地址：北京朝阳区东坝乡和敬路99号院2号楼\n电话：+86-10-89101888',
      },
    ],
    inclusions: ['2 nights accommodation in 4 star hotel', ...emptyConfirmation().inclusions],
  }
}
