'use client'

/**
 * 「我们自己投过的」—— 摆在档案旁边给人看的实测。
 *
 * 这一块**故意**放在可编辑区之外、并且明说「没有动上面的排序」:
 * 2026-08-01 出过一次真实的判断错误 —— 有人拿「每次对话 $27.83，全场最贵」去
 * 质疑 AI 的卖点排序，那个数字背后是 **1 次对话**。所以这里三条规矩:
 *   ① 每个数字旁边就是样本量,不给孤零零的成本数(全部走 ad-benchmarks 的
 *      formatCostWithSample / formatSpendWithSample,本组件不自己拼数字)
 *   ② 没数据就明说「没有数据」,不显示 0,也不显示一个花费数冒充单价
 *   ③ 成色标在最显眼处:攒够 6 套同类才叫规律,否则一律「单轮观察，样本不足」
 */

import {
  benchmarkConfidenceLabel,
  formatCostWithSample,
  formatSpendWithSample,
  type AdReferenceBlock,
  type AdReferenceGroup,
} from '@/lib/listings/ad-benchmarks'

export function AdReferencePanel({ block }: { block: AdReferenceBlock | null }) {
  if (!block) return <EmptyReference />

  const isPattern = block.pattern.tier !== 'unverified'

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-black text-me-charcoal">我们自己投过的</p>
        <span className="text-[11px] font-bold text-me-charcoal/45">
          只作参考 —— 上面的卖点排序是按房子本身排的，没有被这些数字改过
        </span>
      </div>

      <p
        className={`mt-3 rounded-lg border px-3 py-2 text-xs font-black ${
          isPattern
            ? 'border-[#5C8A4A]/30 bg-[#5C8A4A]/8 text-[#5C8A4A]'
            : 'border-me-ochre/35 bg-me-ochre/10 text-me-ochre'
        }`}
      >
        {benchmarkConfidenceLabel(block.pattern)}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <GroupCard title="这套房所属客户的广告账户" group={block.own} />
        <GroupCard title="同类房源（同价格档 · 同区 · 同房型）" group={block.peers} />
      </div>

      {block.limitations.length > 0 && (
        <div className="mt-3 rounded-lg border border-black/10 bg-me-ivory/50 px-3 py-2">
          <p className="text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45">
            这些数字不能拿来干什么
          </p>
          <ul className="mt-1 space-y-1">
            {block.limitations.map((l, i) => (
              <li key={i} className="text-xs font-semibold leading-relaxed text-me-charcoal/60">
                · {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** 一组数字。**每一行都是「数字 · 样本量」**,没有单独的数字行。 */
function GroupCard({ title, group }: { title: string; group: AdReferenceGroup | null }) {
  return (
    <div className="rounded-lg border border-black/10 bg-me-ivory/40 p-3">
      <p className="text-xs font-black text-me-charcoal/70">{title}</p>

      {!group ? (
        <p className="mt-2 text-sm font-bold text-me-charcoal/40">没有数据</p>
      ) : (
        <dl className="mt-2 space-y-2">
          <Line label="每次对话多少钱" value={formatCostWithSample(group)} />
          <Line label="一共花了" value={formatSpendWithSample(group)} />
          <Line
            label="这些数字覆盖"
            value={`${group.sample.listings} 套房源 / ${group.sample.clients} 个客户账户`}
          />
          {group.mixed_with_other_listings && (
            <p className="text-[11px] font-bold leading-relaxed text-me-ochre">
              这是整个广告账户的合计，里面还混着同一个账户的其他房源 —— 拆不到单套房上。
            </p>
          )}
        </dl>
      )}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold text-me-charcoal/45">{label}</dt>
      <dd className="text-sm font-black text-me-charcoal">{value}</dd>
    </div>
  )
}

function EmptyReference() {
  return (
    <section className="rounded-xl border border-dashed border-black/10 bg-white p-4">
      <p className="text-sm font-black text-me-charcoal">我们自己投过的</p>
      <p className="mt-1 text-xs font-semibold leading-relaxed text-me-charcoal/50">
        这一版档案生成时没有可用的投放实测。这不是「投了没效果」——
        是还没有投过、或者数据还没回流。
      </p>
    </section>
  )
}
