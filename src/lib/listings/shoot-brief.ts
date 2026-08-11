/**
 * 一套房的拍摄单 —— 给中介拿去现场照着拍的那张纸。
 *
 * ── 为什么非做不可（PM 2026-08-05）─────────────────────────────────────────
 * 内容工厂已经能自动写文案、自动拼片，但它拼的是**已有的素材**。
 * 地产不行：房子必须真人到现场拍，拼图库素材是没用的。
 * 而「该拍什么」这件事，系统里一个字都没有 —— Roman 那三条分镜是手写在文档里的。
 *
 * ── 为什么长在房源页、跟上传链接放一起 ──────────────────────────────────
 * 拿脚本去拍的人，和传照片的人是同一个人。分开放就变成「脚本在一条微信里、
 * 链接在另一条微信里」，他一定会漏一个。
 *
 * ── 只写「怎么拍」，不写「这房子有多好」──────────────────────────────────
 * 铁律 8：不凭空注入客户业务数据。所以这里出的是**动作指令**（拍哪、拍多久、
 * 怎么运镜），不是对房子的描述。唯一涉及内容的那一条是「你站门口说一句」——
 * 它是**留白**，让中介自己说，而不是我们替他编一句关于这套房的话。
 *
 * 镜头怎么定：**从房源档案里已有的事实推**，不是套一张固定清单。
 * 几间卧室就拍几间；公寓不写后院；没写房型就不出卧室那几条。
 */

/** 拍摄单认得的房型。其余一律按「不确定」走最保守的一套。 */
export type PropertyKind = 'house' | 'apartment' | 'townhouse' | 'section' | 'unknown'

export interface ShootListingFacts {
  address: string
  suburb: string
  bedrooms?: number | null
  propertyType?: string | null
}

export interface Shot {
  /** 第几条。中介照着数字拍，不用理解结构。 */
  no: number
  /** 拍什么 —— 一句话，不带形容词。 */
  what: string
  /** 拍多久（秒）。给区间不给精确值：现场没人掐秒表。 */
  seconds: string
  /** 怎么拍 —— 一个具体动作。空字符串表示「就站着拍，不用动」。 */
  how: string
  /** 这条能不能省。真人出镜那条永远不能省。 */
  optional: boolean
}

export interface ShootBrief {
  title: string
  shots: Shot[]
  /** 全局要求 —— 拍之前先看一眼的三五条。 */
  rules: string[]
  /** 一句话说清这张单子是干嘛的。 */
  intro: string
}

/** 房型归一。认不出的一律 `unknown`，走最保守的一套（不假设有院子）。 */
export function normalisePropertyKind(raw: string | null | undefined): PropertyKind {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return 'unknown'
  if (/apartment|unit|flat|公寓/.test(v)) return 'apartment'
  if (/townhouse|terrace|联排|排屋/.test(v)) return 'townhouse'
  if (/section|land|地皮|土地/.test(v)) return 'section'
  if (/house|home|独立|别墅/.test(v)) return 'house'
  return 'unknown'
}

/** 有没有自己的户外空间 —— 决定要不要拍后院。公寓和不确定的一律当没有。 */
function hasOutdoor(kind: PropertyKind): boolean {
  return kind === 'house' || kind === 'townhouse'
}

/** 最多单独拍几间卧室 —— 再多就是流水账，看的人早划走了。 */
const MAX_BEDROOM_SHOTS = 2

/**
 * 生成拍摄单。
 *
 * 镜头顺序是**买家看片的顺序**，不是走房子的顺序：先给一眼定生死的外观，
 * 再是最大的公共空间，最后才是细节。真人出镜放最后 —— 前面都是房子，
 * 最后一句是「人」，这是卖家向内容唯一真正的差异点。
 */
export function buildShootBrief(listing: ShootListingFacts): ShootBrief {
  const kind = normalisePropertyKind(listing.propertyType)
  const shots: Shot[] = []
  const add = (what: string, seconds: string, how: string, optional = false) =>
    shots.push({ no: shots.length + 1, what, seconds, how, optional })

  if (kind === 'section') {
    // 地皮没有室内。硬套「客厅/主卧」会让人对着空地发愣，然后整张单子都不用了。
    add('从路边看整块地', '5-6 秒', '慢慢横过去，别停')
    add('站在地块中间转一圈', '8-10 秒', '原地慢慢转，手要稳')
    add('周边环境（邻居的房子、街道）', '4-5 秒', '', true)
  } else {
    add('门口正面', '3-5 秒', '横着慢慢过去，别停下来')
    add('进门第一眼看到的地方', '4-5 秒', '从门口往里走，边走边拍')
    add('客厅（或最大的那间）', '5-6 秒', '站门口先拍全景，再慢慢推进去')

    const beds = listing.bedrooms ?? 0
    if (beds > 0) {
      add('主卧', '4-5 秒', '从门口进去，先拍窗户那一面')
      if (beds >= 3) {
        add(`其中一间次卧（${beds} 间里挑最好的一间）`, '3-4 秒', '', true)
      }
    }

    add('厨房台面', '4-5 秒', '手扶一下台面再移开 —— 有人的动作，画面才不像样板房')
    add('浴室', '3-4 秒', '', true)

    if (hasOutdoor(kind)) {
      add('后院 / outdoor living', '5-6 秒', '从室内往外走出去，一镜到底')
    }
    add('从窗户往外看的视野', '3-4 秒', '', true)
  }

  // 真人那条永远在最后，永远不能省。
  add(
    '你自己站在门口，说一句这套房最难得的地方',
    '8-10 秒',
    '手机举高一点、放远一点，让人看到半身；说你自己的话，不用背稿',
  )

  return {
    title: `${listing.address}，${listing.suburb}`,
    intro:
      '照着下面的顺序拍，一条一条来。拍完直接用这一页上的链接传上来 —— ' +
      '不用分类、不用改名、不用剪。剪片是我们的事。',
    shots,
    rules: [
      '**竖着拍**（手机竖着拿）。横着拍的没法用。',
      '每一条**单独录一小段**，不要一镜到底拍完整个房子 —— 剪不动。',
      '拍之前把窗帘拉开、灯全打开。手机会自动压暗，光越足越好。',
      '走动的时候慢一点，比你觉得该有的速度再慢一半。',
      '**不用剪、不用加字幕、不用配音乐。** 原片传上来就行。',
    ],
  }
}

/** 变成一段能直接粘进微信发给中介的纯文本。 */
export function renderShootBrief(brief: ShootBrief, uploadUrl?: string | null): string {
  const lines: string[] = [`📹 ${brief.title} — 拍摄单`, '', brief.intro, '']

  for (const s of brief.shots) {
    const how = s.how ? `　${s.how}` : ''
    lines.push(`${s.no}. ${s.what}（${s.seconds}）${s.optional ? '［可省］' : ''}${how}`)
  }

  lines.push('', '拍之前先看一眼：')
  for (const r of brief.rules) lines.push(`· ${r.replace(/\*\*/g, '')}`)

  if (uploadUrl) {
    lines.push('', `拍完传这里（只属于这套房，直接点开就能传）：`, uploadUrl)
  }
  return lines.join('\n')
}
