/**
 * Public marketing page for the "AI digital human steward" product (/ai-steward), built from the
 * Figma file 「ME 经销商招募页 · 规则与收益模拟」 page 「营销页 v2 · 高级版」. Prices come from the commission
 * rule set so this page and the distributor pages can never disagree. Photos: Unsplash (credited below).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { Cormorant_Garamond, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { AI_STEWARD_RULES_V1 as RULES } from '@/lib/distributor/config'
import { formatDollars } from '@/lib/distributor/simulate'
import './steward.css'

const serif = Noto_Serif_SC({ weight: ['500', '600'], subsets: ['latin'], variable: '--ast-serif', display: 'swap', preload: false })
const sans = Noto_Sans_SC({ weight: ['400', '500', '700'], subsets: ['latin'], variable: '--ast-sans', display: 'swap', preload: false })
const latin = Cormorant_Garamond({ weight: ['400', '500'], style: ['normal', 'italic'], subsets: ['latin'], variable: '--ast-latin', display: 'swap' })

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
        <div><h2 className="serif">工具谁都能买，<br /><span className="goldgrad">懂市场的团队</span>不能</h2></div>
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
    <main className={`ast ${serif.variable} ${sans.variable} ${latin.variable}`}>
      <div className="inner">
        <Hero />
        <Pillars />
        <Hot />
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
