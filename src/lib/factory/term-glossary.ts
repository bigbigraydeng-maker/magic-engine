// 术语表 —— 听写常把品牌/产品名写错，同样的错每一讲都会犯。
// 与其让客户每条片手改一遍，不如做片时自动纠正(真实事故:ThruPlay 被听成 throughplay,
// ChatGPT 被听成 ChadGBT，第2讲 74 条字幕里这类错十几处)。
//
// 只替换「独立出现的拉丁词」——前后不能贴着别的字母数字，避免把 SEO 里的 seo、
// 或某个更长的英文词切一半改掉。中文前后无所谓(中文里夹英文词是常态)。

/** 规范写法 → 听写可能写成的各种样子(全小写比较)。 */
const GLOSSARY: Record<string, string[]> = {
  ThruPlay: ['thruplay', 'throughplay', 'through play', 'thru play', 'trueplay'],
  ChatGPT: ['chatgpt', 'chadgbt', 'chatgbt', 'chat gpt', 'chad gpt', 'chargpt'],
  'Ads Manager': ['ads manager', 'adsmanager', 'ad manager'],
  Facebook: ['facebook', 'face book'],
  Instagram: ['instagram'],
  TikTok: ['tiktok', 'tik tok'],
  WhatsApp: ['whatsapp', 'whats app'],
  Google: ['google'],
  YouTube: ['youtube', 'you tube'],
  SEO: ['seo'],
}

const BOUNDARY = /[A-Za-z0-9]/

/**
 * 把一段字幕里写错的术语换成规范写法。
 * 已经写对的原样不动；被更长英文词包住的不动(如 googleplex 不会被改)。
 */
export function normalizeTerms(text: string): string {
  let out = text ?? ''
  for (const [canonical, variants] of Object.entries(GLOSSARY)) {
    for (const variant of variants) {
      let from = 0
      for (;;) {
        const idx = out.toLowerCase().indexOf(variant, from)
        if (idx < 0) break
        const before = idx > 0 ? out[idx - 1] : ''
        const after = idx + variant.length < out.length ? out[idx + variant.length] : ''
        const standalone = !BOUNDARY.test(before) && !BOUNDARY.test(after)
        if (standalone && out.slice(idx, idx + variant.length) !== canonical) {
          out = out.slice(0, idx) + canonical + out.slice(idx + variant.length)
          from = idx + canonical.length
        } else {
          from = idx + variant.length
        }
      }
    }
  }
  return out
}
