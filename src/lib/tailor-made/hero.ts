import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 封面图按目的地自动选。
 *
 * 甲方原话：「比如是重庆团，首页的大图从长城更换为重庆」。
 * 每份行程都顶着同一张长城图，客人一眼看出是套模板 —— 而定制行程卖的
 * 恰恰是「这是为你做的」。
 *
 * 图内置在 templates/tailor-made-itinerary/heroes/，不走外部图床：
 * chinatravel 的 Supabase 不在本项目的账号下，传不了图；而外链一旦挂掉，
 * 已经发出去的 PDF 也跟着空一块。
 *
 * 图的来源要小心：chinatravel 的 guides 图库里 21 张「城市图」有 18 张其实是
 * 同一张通用 Unsplash 兜底图（历史遗留），照搬会让「换封面」变成换了个寂寞。
 * 所以这 16 张全部来自 tours/ 与 blog/ 目录并逐张核对过内容，无重复。
 *
 * 加新城市：把图放进 heroes/<name>.jpg，在 RULES 里加一条即可，不用改别处。
 */

const HERO_DIR = path.join(process.cwd(), 'templates', 'tailor-made-itinerary', 'heroes')

// 选图规则在 ./hero-rules（纯逻辑，可在客户端跑）；这里只管读文件。
// re-export 让既有调用方不用改 import 路径。
export { matchHeroName, pickHeroName, FALLBACK, HERO_CHOICES } from './hero-rules'
import { FALLBACK, pickHeroName } from './hero-rules'

/**
 * 关键词 → 图片名。顺序即优先级：先匹配到的赢。
 *
 * 把「更具体的」排在前面：一趟北京+西安的行程，用兵马俑还是长城？
 * 用行程标题和路线里**第一个**出现的地点 —— 那通常就是主打卖点。
 */
/** 读成 data URI，供模板内联；读不到时返回 null（模板自带默认图兜底）。 */
export async function loadHeroDataUri(name: string): Promise<string | null> {
  const safe = /^[a-z0-9-]+$/.test(name) ? name : FALLBACK
  try {
    const buf = await readFile(path.join(HERO_DIR, `${safe}.jpg`))
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 一步到位：按行程选图并读成 data URI */
export async function heroForTrip(trip: { title?: string; route?: string[] }): Promise<string | null> {
  return loadHeroDataUri(pickHeroName(trip))
}

/** 原始图片字节（Word 导出用）；名字不合法或读不到时返回 null。 */
export async function loadHeroBuffer(name: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  try {
    return await readFile(path.join(HERO_DIR, `${name}.jpg`))
  } catch {
    return null
  }
}

/**
 * 换封面面板里的小缩略图（320×200，heroes/thumbs/）。
 * 原图每张 150–250KB，四十多张一次全拉会让面板卡好几秒，所以单独存一份小图。
 */
export async function loadHeroThumb(name: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  try {
    return await readFile(path.join(HERO_DIR, 'thumbs', `${name}.jpg`))
  } catch {
    return null
  }
}
