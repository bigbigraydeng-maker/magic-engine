/** Promise / visa / availability / discount wording for the outbound claim scanner. */

import { type ClaimHit, escapeRe } from './outbound-claims-core'

/* ------------------------------------------------------------------ */
/* Word-based detection                                                */
/* ------------------------------------------------------------------ */

const PROMISE_WORDS = [
  '保证', '包过', '包签', '包出签', '包成功', '一定能', '一定可以',
  '百分百', '100%', '确保', '绝对能', '稳过', '无条件', '全额退款',
  '全额退', '必定', '承诺',
  '包您满意', '包满意', '百分之百', '绝对没问题', '绝对可以', '肯定能',
  '肯定可以', '没问题', '担保', '打包票', '一定会', '退钱', '包退',
  '保成行', '保证成行', '必成团',
  '保你满意', '一定帮你', '肯定行', '稳了', '包搞定', '不成功不收费', '不会有问题',
]
const PROMISE_EN = /\b(guarantee|guaranteed|definitely will|money back|we promise|i promise|promise you|definitely|full refund|no problem at all|absolutely|will be refunded|refund you|you will get a refund)\b/gi

const VISA_WORDS = [
  '免签', '落地签', '拒签', '出签', '过签',
  '免签证', '不需要签证', '无需签证', '签证没问题', '不会拒签', '包签',
  '入境不用办理', '不用办理手续',
]
const VISA_CTX = ['免', '无需', '不需要', '不用', '通过', '费用', '办理', '一般', '需要', '要办']
const VISA_EN = /\b(?:visa\b[^.!?]*\b(?:free|waiver|approved|guarantee|fee)\b|no visa needed|no visa required|visa not required|visa is not needed|visa isn't needed|you do not need a visa|don't need a visa|you need a visa|need a visa|visa free|visa-free|nzeta is required|eta is required)\b/gi

const AVAILABILITY_WORDS = [
  '仅剩', '只剩', '余位', '余票', '名额', '满团', '还有位置',
  '还有位子', '位置不多', '席位',
  '最后两个位置', '最后几位', '最后几个位置', '最后一个位置', '只剩最后',
  '快满', '即将满团', '快订满',
  '还剩', '座位不多', '剩下最后', '仅余', '余座',
  '还有座位', '有空位', '仍有空位', '订满', '已满', '座位',
]
const AVAILABILITY_EN = /\b(seats? left|spots? left|sold out|sold-out|fully booked|limited availability|almost full|last few seats|last seats|a few seats left|nearly full|only \d+ left|last (?:two|three|few|\d+) seats?|seats? available|places? available|still have (?:a few )?(?:spots|seats|places)|\d+ (?:rooms?|seats?|places?|spots?) left)\b/gi

const DISCOUNT_WORDS = [
  '最低价', '最便宜', '全网最低', '免费升级', '免费赠送', '免费送',
  '赠送', '优惠', '折扣', '立减', '打折', '特价', '限时',
  '半价', '买一送一', '送机', '包早餐', '免费早餐', '早鸟', '底价',
  '内部价', '特惠', '促销', '优惠价',
  '买一赠一', '白送', '满减', '直降',
  '免费取消', '免费改期', '省', '减免', '免费',
]
const DISCOUNT_EN = /\b(discount|half price|half-price|half off|half the price|free upgrade|free breakfast|free transfer|free gift|free cancellation|free pickup|free of charge|for free|best price|lowest price|buy one get one|percent off|early bird|no extra charge|save \d+|\d+ off)\b|\d+\s*percent off/gi

export function detectWords(text: string, hits: ClaimHit[]): void {
  let m: RegExpExecArray | null

  for (const w of PROMISE_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'promise', match: m[0] })
  }
  while ((m = PROMISE_EN.exec(text)) !== null) hits.push({ kind: 'promise', match: m[0] })

  for (const w of VISA_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'visa', match: m[0] })
  }
  // 签证 in same sentence as context word
  const sentences = text.split(/[。！？.!?\n]/)
  for (const s of sentences) {
    if (s.includes('签证') && VISA_CTX.some((c) => s.includes(c))) {
      hits.push({ kind: 'visa', match: '签证' })
    }
  }
  while ((m = VISA_EN.exec(text)) !== null) hits.push({ kind: 'visa', match: m[0] })

  for (const w of AVAILABILITY_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'availability', match: m[0] })
  }
  // 剩N位
  const remaining = /剩\s*(?:\d+|[一二三四五六七八九十]+)\s*位/g
  while ((m = remaining.exec(text)) !== null) hits.push({ kind: 'availability', match: m[0] })
  while ((m = AVAILABILITY_EN.exec(text)) !== null) hits.push({ kind: 'availability', match: m[0] })

  for (const w of DISCOUNT_WORDS) {
    const re = new RegExp(escapeRe(w), 'g')
    while ((m = re.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
  }
  // N折
  const zhe = /(?:\d+|[一二三四五六七八九十]+)\s*折/g
  while ((m = zhe.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
  // N% off / N%
  const pct = /\d+\s*%/g
  while ((m = pct.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
  while ((m = DISCOUNT_EN.exec(text)) !== null) hits.push({ kind: 'discount', match: m[0] })
}

