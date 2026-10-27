import type { BrandExample, BrandFrame, MediaClip, StyleDifference, StyleFamilyRecord, StylePackRecord, TemplateLibrary, TemplateRecord } from './types'

const ROOT = '/template-library'

function portrait(folder: string, file: string, label: string): MediaClip {
  const base = file.replace(/\.mp4$/, '')
  return {
    src: `${ROOT}/${folder}/${base}.mp4`,
    poster: `${ROOT}/${folder}/${base}.jpg`,
    label,
    shape: 'portrait',
  }
}

function wide(folder: string, file: string, label: string): MediaClip {
  const base = file.replace(/\.mp4$/, '')
  return {
    src: `${ROOT}/${folder}/${base}.mp4`,
    poster: `${ROOT}/${folder}/${base}.jpg`,
    label,
    shape: 'wide',
  }
}

function stack(folder: string, file: string, label: string): MediaClip {
  const clip = wide(folder, file, label)
  return { ...clip, shape: 'stack' }
}

function still(file: string): string {
  return `${ROOT}/templates/${file}`
}

function brandFrames(prefix: string): BrandFrame[] {
  return [
    { label: '开头', src: `${ROOT}/brands/${prefix}-open.png` },
    { label: '中间', src: `${ROOT}/brands/${prefix}-mid.png` },
    { label: '结尾', src: `${ROOT}/brands/${prefix}-end.png` },
  ]
}

function pack(
  id: string,
  name: string,
  familyId: string,
  difference: StyleDifference,
): StylePackRecord {
  return {
    id,
    name,
    familyId,
    availability: 'upcoming',
    difference,
    clip: portrait('styles', `${id}.mp4`, `${name}，单独看一条`),
  }
}

const FAMILIES: readonly StyleFamilyRecord[] = [
  { id: 'flash', name: '抖音快节奏', tier: 'platform', summary: '闪得快，字像打字机，适合还没认识你的人。' },
  { id: 'minimal', name: '高级极简', tier: 'platform', summary: '留白多。简洁大约两秒一刀，高端用更长的镜头。' },
  { id: 'warm', name: '温暖生活感', tier: 'industry', summary: '餐饮、家政、美容。语气像过日子，不像喊麦。' },
  { id: 'documentary', name: '纪录片质感', tier: 'industry', summary: '旅游和房产。镜头长，字不抢画面。' },
  { id: 'promo', name: '促销冲击', tier: 'industry', summary: '零售。字和画面一起砸进来。' },
  { id: 'data', name: '硬核数据', tier: 'industry', summary: '科技和教育。数字和短句比气氛重要。' },
]

const PACKS: readonly StylePackRecord[] = [
  pack('vivid', '活力', 'flash', {
    transition: '闪一下白，然后硬切',
    textMotion: '一个字一个字打出来',
    rhythm: '大约 1.5 秒切一刀',
    caption: '贴纸气泡',
  }),
  pack('clean', '简洁', 'minimal', {
    transition: '像擦玻璃一样揭开',
    textMotion: '整行滑进来',
    rhythm: '大约 2 秒切一刀',
    caption: '画面正中一张大字卡',
  }),
  pack('premium', '高端', 'minimal', {
    transition: '先擦开，再从下往上推',
    textMotion: '整行滑进来',
    rhythm: '3 秒以上的长镜头',
    caption: '靠下三分之一的一条',
  }),
  pack('dining', '餐饮', 'warm', {
    transition: '从旁边滑入',
    textMotion: '弹出来',
    rhythm: '大约 2 秒切一刀',
    caption: '靠下三分之一的一条',
  }),
  pack('home', '家政上门', 'warm', {
    transition: '从旁边滑入，再往上推',
    textMotion: '弹出来',
    rhythm: '大约 2 秒切一刀',
    caption: '贴纸气泡',
  }),
  pack('beauty', '美容', 'warm', {
    transition: '慢慢淡入',
    textMotion: '像手写描边',
    rhythm: '大约 2 秒切一刀',
    caption: '贴纸气泡',
  }),
  pack('travel', '旅游', 'documentary', {
    transition: '慢慢淡入',
    textMotion: '像手写描边',
    rhythm: '3 秒以上的长镜头',
    caption: '贴在画面底部，字带描边',
  }),
  pack('property', '房产', 'documentary', {
    transition: '从下往上推',
    textMotion: '整行滑进来',
    rhythm: '3 秒以上的长镜头',
    caption: '画面正中一张大字卡',
  }),
  pack('retail', '零售', 'promo', {
    transition: '猛地放大砸进来，再闪一下白',
    textMotion: '弹出来',
    rhythm: '大约 1.5 秒切一刀',
    caption: '贴纸气泡',
  }),
  pack('b2b', '科技', 'data', {
    transition: '硬切，没有过渡',
    textMotion: '词语逐个亮一下',
    rhythm: '大约 2 秒切一刀',
    caption: '靠下三分之一的一条',
  }),
  pack('education', '教育', 'data', {
    transition: '硬切，再闪一下白',
    textMotion: '一个字一个字打出来',
    rhythm: '大约 2 秒切一刀',
    caption: '贴在画面底部，字带描边',
  }),
]

function samples(template: string, labels: readonly [string, string, string]): MediaClip[] {
  const packsForTemplate = ['vivid', 'travel', 'b2b'] as const
  return packsForTemplate.map((id, index) => portrait('samples', `${template}-${id}.mp4`, labels[index] ?? id))
}

const TEMPLATES: readonly TemplateRecord[] = [
  {
    id: 'list',
    name: '清单',
    blurb: '先甩三行短句，再逐条说包含什么，最后给价格。',
    goodFor: '套餐、价目、上门范围、行程里有什么、卖点加一个价格。',
    skipWhen: '没有真实画面、只能放一块糊颜色的时候。抽象服务别用它当主片。',
    availability: 'live',
    poster: still('list.jpg'),
    posterShape: 'wide',
    posterLabel: '清单在几个示例行业里的样子',
    comparison: wide('compare', 'list.mp4', '同一条清单，并排换剪法'),
    samples: samples('list', ['套上活力', '套上旅游', '套上科技']),
  },
  {
    id: 'montage',
    name: '快切',
    blurb: '跟着音乐快速换画面，中间砸一块大字。',
    goodFor: '菜名、上新、天数，这种前几秒就要抓住人的短词。',
    skipWhen: '教育、科技、以及要显贵的房产主片。大字会像喊麦。',
    availability: 'live',
    poster: still('montage.jpg'),
    posterShape: 'wide',
    posterLabel: '快切在几个示例行业里的样子',
    comparison: wide('compare', 'montage.mp4', '同一条快切，并排换剪法'),
    samples: samples('montage', ['套上活力', '套上旅游', '套上科技']),
  },
  {
    id: 'datacard',
    name: '数据卡',
    blurb: '纯色底上比几行数字，不靠镜头。',
    goodFor: '档位、标价、学费、按小时收费、几套房放在一起比。',
    skipWhen: '观众必须看见菜、房间或发型的时候。它是补充，不能当主画面。',
    availability: 'live',
    poster: still('datacard.jpg'),
    posterShape: 'wide',
    posterLabel: '数据卡在几个示例行业里的样子',
    comparison: wide('compare', 'datacard.mp4', '同一张数据卡，并排换剪法'),
    samples: samples('datacard', ['套上活力', '套上旅游', '套上科技']),
  },
  {
    id: 'postcard',
    name: '明信片',
    blurb: '一个画面一句慢字幕，最后才是价格或一句收尾。',
    goodFor: '一个地方或一间店，想让人看完，而不是划走。',
    skipWhen: '开会、上课、干活步骤、一件衣服。没有真实画面时只剩字。',
    availability: 'live',
    poster: still('postcard.jpg'),
    posterShape: 'wide',
    posterLabel: '明信片在几个示例行业里的样子',
    comparison: null,
    samples: [],
  },
  {
    id: 'atmosphere',
    name: '氛围',
    blurb: '一段画面不切，可以配一句话，没有价格。',
    goodFor: '画面本身就是卖点：水面、光线、店堂。',
    skipWhen: '科技方案、课程、单件商品、上门步骤。没有风景时就是一块颜色加一句话。',
    availability: 'live',
    poster: still('atmosphere.jpg'),
    posterShape: 'wide',
    posterLabel: '氛围片在几个示例行业里的样子',
    comparison: wide('compare', 'atmosphere.mp4', '同一条氛围片，并排换剪法'),
    samples: samples('atmosphere', ['套上活力', '套上旅游', '套上科技']),
  },
  {
    id: 'compare',
    name: '前后对比',
    blurb: '先看之前，再看正在做，停在做完的画面。',
    goodFor: '打扫前后、护理前后，这种「变了」一眼能看懂的事。',
    skipWhen: '没有前后两段真实画面的时候。出片不会自动选它，工单要点名。',
    availability: 'upcoming',
    poster: still('compare.jpg'),
    posterShape: 'portrait',
    posterLabel: '前后对比的一帧。文案是示例客户，画面是色块，不是实拍。',
    comparison: portrait('templates', 'compare.mp4', '前后对比整段：油污还在，擦完停住'),
    samples: [],
  },
]

const BRANDS: readonly BrandExample[] = [
  { id: 'a-vivid', customer: '示例客户 A', packName: '活力', frames: brandFrames('a-vivid') },
  { id: 'b-vivid', customer: '示例客户 B', packName: '活力', frames: brandFrames('b-vivid') },
  { id: 'a-travel', customer: '示例客户 A', packName: '旅游', frames: brandFrames('a-travel') },
  { id: 'b-travel', customer: '示例客户 B', packName: '旅游', frames: brandFrames('b-travel') },
  { id: 'a-retail', customer: '示例客户 A', packName: '零售', frames: brandFrames('a-retail') },
  { id: 'b-retail', customer: '示例客户 B', packName: '零售', frames: brandFrames('b-retail') },
]

/** Read-only catalog. A new template or style is one more record plus its preview file. */
export const TEMPLATE_LIBRARY: TemplateLibrary = {
  notice: '标了「现在就能用」的版式，今天的出片机就认。标了「还在审核」的前后对比，以及这一页所有剪法，要等那次改动合进系统之后，工单里才能点名。剪法不填时，片子仍是现在的样子。画面和店名都是「示例客户」。',
  styleReel: stack('styles', 'six.mp4', '六种剪法摆在一起'),
  styleOverview: `${ROOT}/styles/overview.png`,
  templates: TEMPLATES,
  families: FAMILIES,
  packs: PACKS,
  brandExamples: BRANDS,
}
