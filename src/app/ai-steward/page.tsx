/**
 * Public marketing page for the "AI digital human steward" product (/ai-steward), built from the
 * Figma file 「ME 经销商招募页 · 规则与收益模拟」 page 「营销页 v2 · 高级版」. Prices come from the commission
 * rule set so this page and the distributor pages can never disagree. Photos: Unsplash (credited below).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { AI_STEWARD_RULES_V1 as RULES } from '@/lib/distributor/config'
import { formatDollars } from '@/lib/distributor/simulate'
import './steward.css'

/**
 * Fonts load from Google Fonts at view time, not through next/font: next/font downloads them during
 * the build, and a failed download of the large CJK serif would fail the whole site's build. If the
 * stylesheet does not load, the page falls back to system fonts.
 */
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@500;600&display=swap'

export const metadata: Metadata = {
  title: 'AI 数字人管家 · 老板不用出镜，每天都有新视频',
  description: 'AI 数字人管家：脚本、出片、发布和数据一站完成，3 个工作日出片，由熟悉新西兰市场的本地团队和你一起运营账号。',
}

const IMG = '/marketing/ai-steward'
const PHOTO_CREDITS = ['Brooke Cagle', 'Sulthan Auliya', 'Cherrydeck', 'Vitaly Gariev', 'Jakob Owens']
const RECOMMENDED_PLAN = 'videos-16'
const CONTACT_HREF = '/contact'

const bg = (file: string) => ({ backgroundImage: `url('${IMG}/${file}')` })
const Br = () => <br className="dbr" />

const PILLARS = [
  { n: '01', img: 'akl.jpg', title: ['新西兰本地团队，', '实时沟通'], body: '熟悉新西兰市场的团队负责开发和运营。和你在同一个时区，有问题直接找人，不用排工单。' },
  { n: '02', img: 'team.jpg', title: ['先看样片，', '再做决定'], body: '聊的时候先给你看我们做过的样片，满意了再开始。' },
] as const

const HOT = [
  { dt: '11·27', t: '黑色星期五', s: '提前一周出促销短片，抢在客人下单前' },
  { dt: '12月', t: '圣诞送礼季', s: '礼品推荐、假期营业时间提醒' },
  { dt: '夏季', t: '新西兰夏天开始', s: '户外、旅游、餐饮类内容正当时' },
  { dt: '12·26', t: 'Boxing Day', s: '清仓、换季活动短片' },
] as const

const FEATURES = [
  { k: 'i.', t: '脚本创作', p: '按你的产品和客人写短视频脚本' },
  { k: 'ii.', t: '数字人出镜', p: '老板不用自己拍，数字人替你说' },
  { k: 'iii.', t: '热点抓取', p: '每周跟进和你行业有关的热点' },
  { k: 'iv.', t: '专业文案', p: '标题、正文、标签一起写好' },
  { k: 'v.', t: '账号内容架构分析', p: '看清账号该发什么，紧贴行业主流' },
  { k: 'vi.', t: '发布与数据回看', p: '按时发出去，再拉回数据看效果' },
] as const

const LOCAL = [
  { k: 'NZST / NZDT', t: '按新西兰时区排期发布', p: '按 Pacific/Auckland 时区和夏令时切换排发布时间，内容出现在本地客人刷手机的时段，不是海外团队的上班时间。' },
  { k: 'Local Calendar', t: '本地节庆日历', p: 'Waitangi Day、ANZAC Day、Matariki、Labour Day、Boxing Day……新西兰自己的节点，提前排进内容日历。' },
  { k: 'NZ English', t: '本地语感和拼写', p: 'colour、centre、organise，本地客人一眼就看得出是不是“自己人”写的。美式拼写和翻译腔，会直接拉低信任。' },
  { k: 'Fair Trading Act', t: '按本地法规写文案', p: '文案按新西兰《公平交易法》和广告标准局（ASA）的要求写，不写夸大、误导的承诺，降低被投诉的风险。' },
  { k: 'Market Context', t: '本地行业语境', p: '同一个行业，在新西兰的客群、价格带、竞争对手都和澳洲、中国不一样。照搬别的市场的打法，客人不买账。' },
  { k: 'Bilingual Audience', t: '华人 + 本地英语客群', p: '一套内容，两种讲法：中文讲给华人社区，英文讲给本地客人，口径一致、各说各的话。' },
] as const

const ENGINE = [
  { n: '01', en: 'Trend Signal Mining', zh: '热点信号采集', p: '每周扫描行业关键词、本地新闻和平台趋势，筛出和你的客人有关的热点。' },
  { n: '02', en: 'Content Pillar Architecture', zh: '内容支柱架构', p: '定账号定位、内容矩阵和发布节奏：哪类内容占几成、每周发几条、各自负责什么。' },
  { n: '03', en: 'Hook Engineering', zh: '前 3 秒钩子工程', p: '按「冲突 → 场景 → 行动」结构写脚本，前 3 秒先抓住人，再讲产品。' },
  { n: '04', en: 'Digital Human Rendering', zh: '数字人生成', p: '口型同步（lip-sync）、多个数字人形象、中英文配音，老板不用出镜。' },
  { n: '05', en: 'Distribution Timing', zh: '分发时机', p: '按新西兰时区和平台节奏排期，自动发布到 Facebook / Instagram。' },
  { n: '06', en: 'Performance Feedback Loop', zh: '数据回流', p: '拉回每条视频的播放、覆盖、分享、收藏，回写到下一轮的选题和脚本。' },
] as const

const METRICS = ['Views 播放', 'Reach 覆盖', 'Shares 分享', 'Saves 收藏', 'Content Pillars', 'Hook Structure', 'Posting Cadence']

const COMPARE = [
  { k: '沟通', us: '同一个时区，有问题直接找人', them: '隔着时差，反馈常常要等一天' },
  { k: '节日与热点', us: '新西兰本地节庆日历提前排好', them: '按通用节日排内容，漏掉本地节点' },
  { k: '语言', us: 'NZ English 拼写和本地说法', them: '美式拼写或翻译腔，一看就是外地' },
  { k: '法规', us: '按《公平交易法》和 ASA 规范写文案', them: '不熟悉本地规范，容易写出夸大承诺' },
  { k: '行业判断', us: '懂新西兰的客群、价格带和竞争对手', them: '照搬其他市场的打法' },
] as const

const STEPS = [
  { k: '01', t: '免费咨询', p: '了解你的生意、客人和现在的账号' },
  { k: '02', t: '账号诊断', p: '分析内容架构，定好发什么、怎么发' },
  { k: '03', t: '3 个工作日出片', p: '按约定交付，细节随时沟通' },
  { k: '04', t: '发布与复盘', p: '按时发出，每月看数据再调整' },
] as const

function Hero() {
  const plans = RULES.catalog.plans
  const minVideos = Math.min(...plans.map((p) => p.videosPerMonth))
  const maxVideos = Math.max(...plans.map((p) => p.videosPerMonth))
  const fromCents = Math.min(...plans.map((p) => p.monthlyCents))
  return (
    <>
      <div className="nav">
        <div className="logo">MAGIC ENGINE</div>
        <div className="links"><a href="#why">服务</a><a href="#hot">热点</a><a href="#pricing">价格</a><Link href={CONTACT_HREF}>开始合作</Link></div>
      </div>
      <section className="hero" style={bg('owner.jpg')}>
        <div className="veil" />
        <div className="in">
          
          <h1 className="serif">老板不用出镜，<br /><span className="goldgrad">每天都有新视频</span></h1>
          <p className="lead muted">AI 数字人管家，从脚本、出片到发布和数据，一站完成。<Br />由熟悉新西兰市场的本地团队，和你一起经营账号。</p>
          <div className="ctas"><Link href={CONTACT_HREF} className="btn gold-solid">预约免费咨询</Link><a href="#pricing" className="btn line">查看价格</a></div>
        </div>
        <div className="phone" aria-hidden="true">
          <div className="screen" style={bg('hero.jpg')}>
            <div className="scrim" />
            <div className="rec"><i />数字人出镜</div>
            <div className="cap"><div className="who">示例画面</div><div className="say">今天的热点，<br />30 秒讲清楚你的新品</div><div className="bar"><i /></div></div>
          </div>
        </div>
      </section>
      <div className="stats">
        <div className="stat"><div className="n goldgrad">3<small>个工作日</small></div><div className="l">每条视频交付</div></div>
        <div className="stat"><div className="n">{minVideos}–{maxVideos}<small>条</small></div><div className="l">每月视频</div></div>
        <div className="stat"><div className="n">{RULES.catalog.includedAvatars}<small>个</small></div><div className="l">数字人默认包含</div></div>
        <div className="stat"><div className="n">{formatDollars(fromCents, true)}<small>起</small></div><div className="l">每月</div></div>
      </div>
    </>
  )
}

function Pillars() {
  return (
    <section className="sec" id="why">
      <div className="head">
        <div><h2 className="serif">工具谁都能买，<br /><span className="goldgrad">懂新西兰的团队</span>买不到</h2></div>
        <p className="intro">我们多给你的，是一支熟悉新西兰市场的本地团队，和说到做到的交付。</p>
      </div>
      {PILLARS.map((p, i) => (
        <div key={p.n} className={i % 2 === 1 ? 'prow rev' : 'prow'}>
          <div className="pimg" style={bg(p.img)} role="img" aria-label={p.title.join('')} />
          <div className="ptxt"><div className="pnum goldgrad">{p.n}</div><h3 className="serif">{p.title[0]}<Br />{p.title[1]}</h3><p>{p.body}</p><div className="hair" /></div>
        </div>
      ))}
      <div className="prow">
        <div className="pimg" style={bg('hero.jpg')} role="img" aria-label="3 个工作日出片" />
        <div className="ptxt">
          <div className="pnum goldgrad">03</div><h3 className="serif">3 个工作日出片，<Br />细节随时沟通</h3>
          <p>每条视频 <span className="em">3 个工作日</span> 内交付。文案、画面、数字人形象，有想法随时说，我们跟着改。</p><div className="hair" />
        </div>
      </div>
    </section>
  )
}

function LocalCraft() {
  return (
    <section className="sec" id="local">
      <div className="head">
        <div><h2 className="serif">本地化，<br /><span className="goldgrad">是一门技术</span></h2></div>
        <p className="intro">在新西兰做内容，难的不是剪视频，是这些外面的团队看不见的细节。</p>
      </div>
      <div className="lgrid">
        {LOCAL.map((l) => (
          <div key={l.k} className="lc"><div className="code">{l.k}</div><h3 className="serif">{l.t}</h3><p>{l.p}</p></div>
        ))}
      </div>
    </section>
  )
}

function Compare() {
  return (
    <section className="sec">
      <div className="head"><div><h2 className="serif">为什么不找<Br />海外外包？</h2></div>
        <p className="intro">价格可能更低，但每一条内容的细节，都在提醒客人：这不是本地商家。</p></div>
      <div className="ctable" role="table" aria-label="本地团队和海外外包的对比">
        <div className="crow chead" role="row"><div role="columnheader" /><div role="columnheader" className="us">Magic Engine 本地团队</div><div role="columnheader">海外外包常见情况</div></div>
        {COMPARE.map((c) => (
          <div key={c.k} className="crow" role="row"><div role="cell" className="ck">{c.k}</div><div role="cell" className="us">{c.us}</div><div role="cell" className="them">{c.them}</div></div>
        ))}
      </div>
    </section>
  )
}

function Engine() {
  return (
    <section className="sec" id="engine">
      <div className="head">
        <div><h2 className="serif">内容引擎，<br /><span className="goldgrad">每周跑一整圈</span></h2></div>
        <p className="intro">从热点到数据，六个环节环环相扣。每一轮的数据，都会喂给下一轮的脚本。</p>
      </div>
      <div className="engine">
        {ENGINE.map((e) => (
          <div key={e.n} className="erow">
            <div className="en"><span className="num">{e.n}</span><span className="label">{e.en}</span></div>
            <div className="ez"><h3 className="serif">{e.zh}</h3><p>{e.p}</p></div>
          </div>
        ))}
      </div>
      <div className="metrics">{METRICS.map((m) => <span key={m}>{m}</span>)}</div>
    </section>
  )
}

function Hot() {
  return (
    <section className="sec" id="hot">
      <div className="head">
        <div><span className="live"><i />本周热点</span><h2 className="serif">热点我们盯，<br /><span className="goldgrad">文案我们写</span></h2></div>
        <p className="intro">每周抓和你的行业、你的客人有关的热点，写成能直接发的视频脚本和文案。</p>
      </div>
      <div className="hotgrid">
        <div className="hotlist">
          {HOT.map((h) => (
            <div key={h.t} className="hrow"><div className="dt">{h.dt}</div><div><div className="t serif">{h.t}</div><div className="s">{h.s}</div></div></div>
          ))}
          <div className="note">以上为示例，实际按你的行业每周抓取</div>
        </div>
        <div className="hotimg" style={bg('phone.jpg')} role="img" aria-label="手机上的社交媒体主页" />
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="sec">
      <div className="head"><div><h2 className="serif">每个月，<Br />你得到一整套内容团队</h2></div></div>
      <div className="fgrid">
        {FEATURES.map((f) => (
          <div key={f.t} className="fi"><div className="k">{f.k}</div><h3 className="serif">{f.t}</h3><p>{f.p}</p></div>
        ))}
      </div>
    </section>
  )
}

function Pricing() {
  return (
    <section className="sec" id="pricing">
      <div className="head">
        <div><h2 className="serif">按每月视频条数收费</h2></div>
        <p className="intro">新西兰元计价，按月付费。</p>
      </div>
      <div className="plans">
        {RULES.catalog.plans.map((plan) => {
          const hl = plan.code === RECOMMENDED_PLAN
          return (
            <div key={plan.code} className={hl ? 'plan hl' : 'plan'}>
              {hl ? <span className="tag">推荐</span> : null}
              <div className="v">每月 {plan.videosPerMonth} 条</div>
              <div className={hl ? 'p goldgrad' : 'p'}>{formatDollars(plan.monthlyCents, true)}<small>/月</small></div>
              <div className="e">平均每条 {formatDollars(Math.round(plan.monthlyCents / plan.videosPerMonth))}</div>
            </div>
          )
        })}
      </div>
      <p className="incl">每个套餐默认含 {RULES.catalog.includedAvatars} 个数字人，每多 1 个一次性加 {formatDollars(RULES.catalog.extraAvatarOneTimeCents, true)}。价格以 Magic Engine 当时公布的为准。</p>
    </section>
  )
}

function Steps() {
  return (
    <section className="sec">
      <div className="head"><div><h2 className="serif">四步，<br />下个月就开始发</h2></div></div>
      <div className="steps">
        {STEPS.map((s) => (
          <div key={s.k} className="st"><div className="k">{s.k}</div><h3 className="serif">{s.t}</h3><p>{s.p}</p><div className="hair" /></div>
        ))}
      </div>
    </section>
  )
}

export default function AiStewardPage() {
  return (
    <main className="ast">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={FONTS_HREF} />
      <div className="inner">
        <Hero />
        <Pillars />
        <LocalCraft />
        <Compare />
        <Hot />
        <Engine />
        <Features />
        <Pricing />
        <Steps />
        <section className="final" style={bg('owner.jpg')}>
          <div className="veil" />
          <div className="in">
            
            <h2 className="serif">下个月，你的账号<br /><span className="goldgrad">每天都有新内容</span></h2>
            <p className="sub muted">先免费聊一次，看看适不适合你的生意。</p>
            <div className="ctas"><Link href={CONTACT_HREF} className="btn gold-solid">预约免费咨询</Link></div>
          </div>
        </section>
        <footer className="foot"><span>© Magic Engine · 新西兰</span><span>图片来自 Unsplash：{PHOTO_CREDITS.join('、')}</span></footer>
      </div>
    </main>
  )
}
