#!/usr/bin/env python3
"""Read-only analysis of a Meta Ads Manager CSV export (ad level). Prints a Markdown report."""
import argparse
import csv
import sys
from collections import defaultdict

# Ads Manager column names differ by UI language; map each logical field to known headers.
COLUMNS = {
    "ad": ["广告名称", "Ad name"],
    "adset": ["广告组名称", "Ad set name"],
    "campaign": ["广告系列名称", "Campaign name"],
    "status": ["广告投放", "Ad delivery"],
    "objective": ["目标", "Objective"],
    "result_metric": ["成效指标", "Result indicator"],
    "results": ["成效", "Results"],
    "spend": ["已花费金额 (NZD)", "已花费金额 (AUD)", "已花费金额 (USD)", "Amount spent (NZD)", "Amount spent (AUD)", "Amount spent (USD)"],
    "impressions": ["展示次数", "Impressions"],
    "reach": ["覆盖人数", "Reach"],
    "frequency": ["频次", "Frequency"],
    "link_clicks": ["链接点击量", "Link clicks"],
    "lpv": ["落地页浏览量", "Landing page views"],
    "plays_3s": ["播放视频达 3 秒的次数", "3-second video plays"],
    "thruplay": ["15 秒 ThruPlay 次数", "ThruPlays"],
    "budget": ["广告组预算", "Ad set budget"],
    "budget_type": ["广告组预算类型", "Ad set budget type"],
    "end": ["结束日期", "Ends"],
    "start_report": ["报告开始日期", "Reporting starts"],
    "end_report": ["报告结束日期", "Reporting ends"],
}

PURCHASE_OR_LEAD = ("购买", "销售", "潜在客户", "Sales", "Leads", "Conversions", "转化")


def pick(row, field):
    for name in COLUMNS[field]:
        if name in row:
            return row[name]
    return ""


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def ratio(a, b):
    return a / b if b else None


def fmt(value, kind="n"):
    if value is None:
        return "—"
    if kind == "$":
        return f"${value:,.2f}"
    if kind == "%":
        return f"{value * 100:.1f}%"
    if kind == "x":
        return f"{value:.2f}"
    return f"{value:,.0f}"


def load(path, include, exclude):
    with open(path, encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if rows and not pick(rows[0], "ad") and "广告名称" not in rows[0] and "Ad name" not in rows[0]:
        sys.exit("这不是广告层级的导出：缺「广告名称 / Ad name」列。导出时层级选「广告」。")
    kept = []
    for row in rows:
        label = " ".join((pick(row, "campaign"), pick(row, "adset"), pick(row, "ad")))
        if not pick(row, "ad"):
            continue
        if include and not any(word in label for word in include):
            continue
        if exclude and any(word in label for word in exclude):
            continue
        kept.append(row)
    return kept


def metrics(rows):
    total = defaultdict(float)
    for row in rows:
        for field in ("spend", "impressions", "reach", "link_clicks", "lpv", "plays_3s", "thruplay"):
            total[field] += num(pick(row, field))
    total["cpc"] = ratio(total["spend"], total["link_clicks"])
    total["ctr"] = ratio(total["link_clicks"], total["impressions"])
    total["lpv_rate"] = ratio(total["lpv"], total["link_clicks"])
    total["cost_lpv"] = ratio(total["spend"], total["lpv"])
    total["cpm"] = ratio(total["spend"] * 1000, total["impressions"])
    return total


def flags_for(row, args):
    out = []
    spend = num(pick(row, "spend"))
    clicks = num(pick(row, "link_clicks"))
    lpv = num(pick(row, "lpv"))
    freq = num(pick(row, "frequency"))
    status = pick(row, "status")
    if status == "active" and spend == 0:
        out.append("在投但没花钱")
    if spend > 0 and clicks < args.min_clicks:
        out.append(f"点击不足 {args.min_clicks}，先不判")
    if clicks >= args.min_clicks and lpv == 0:
        out.append("有点击但落地页浏览为 0（落点没装像素或没读到，先核实）")
    elif clicks >= args.min_clicks and ratio(lpv, clicks) is not None and ratio(lpv, clicks) < args.lpv_rate:
        out.append(f"点到落地率 {ratio(lpv, clicks) * 100:.0f}%，偏低")
    if freq >= args.freq:
        out.append(f"频次 {freq:.1f}，看是否疲劳")
    return out


def table(rows, args):
    lines = [
        "| 广告 | 广告组 | 状态 | 花费 | 成效（各按自己的目标） | 链接点击 | 单次点击 | 链接点击率 | 点到落地率 | 每次落地浏览 | 频次 | 提示 |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in sorted(rows, key=lambda r: -num(pick(r, "spend"))):
        spend = num(pick(row, "spend"))
        clicks = num(pick(row, "link_clicks"))
        lpv = num(pick(row, "lpv"))
        imp = num(pick(row, "impressions"))
        metric = pick(row, "result_metric") or "（没有成效）"
        result = f"{fmt(num(pick(row, 'results')))} · {metric}"
        lines.append(
            f"| {pick(row, 'ad')} | {pick(row, 'adset')} | {pick(row, 'status')} | {fmt(spend, '$')} | {result} "
            f"| {fmt(clicks)} | {fmt(ratio(spend, clicks), '$')} | {fmt(ratio(clicks, imp), '%')} "
            f"| {fmt(ratio(lpv, clicks), '%')} | {fmt(ratio(spend, lpv), '$')} | {fmt(num(pick(row, 'frequency')), 'x')} "
            f"| {'；'.join(flags_for(row, args)) or ''} |"
        )
    return "\n".join(lines)


def rollup(rows, key):
    groups = defaultdict(list)
    for row in rows:
        groups[pick(row, key)].append(row)
    lines = [
        "| 名称 | 广告数 | 花费 | 链接点击 | 单次点击 | 点到落地率 | 每次落地浏览 | 千次展示 | 成效种类 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, items in sorted(groups.items(), key=lambda kv: -metrics(kv[1])["spend"]):
        m = metrics(items)
        kinds = sorted({pick(r, "result_metric") for r in items if pick(r, "result_metric")})
        mixed = "（混了多种，不许相加）" if len(kinds) > 1 else ""
        lines.append(
            f"| {name} | {len(items)} | {fmt(m['spend'], '$')} | {fmt(m['link_clicks'])} | {fmt(m['cpc'], '$')} "
            f"| {fmt(m['lpv_rate'], '%')} | {fmt(m['cost_lpv'], '$')} | {fmt(m['cpm'], '$')} | {'、'.join(kinds) or '—'}{mixed} |"
        )
    return "\n".join(lines)


def account_warnings(rows):
    out = []
    objectives = sorted({pick(r, "objective") for r in rows if pick(r, "objective")})
    spenders = [r for r in rows if num(pick(r, "spend")) > 0]
    if spenders and not any(any(w in pick(r, "objective") for w in PURCHASE_OR_LEAD) for r in spenders):
        out.append(f"所有花钱的广告目标都是「{'、'.join(objectives)}」，没有一条按买票/留资去找人；平台这边看不到成交，成绩只能靠售票或客户后台的真账本对。")
    starts = {pick(r, "start_report") for r in rows}
    ends = {pick(r, "end_report") for r in rows}
    out.append(f"这份表是一整段汇总（{'/'.join(sorted(starts))} 到 {'/'.join(sorted(ends))}），没有逐日拆分，不能判趋势；判「变好还是变差」要再导一份按天拆的，或用接口按天读。")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path")
    parser.add_argument("--include", nargs="*", default=[], help="只保留系列/组/广告名里含这些词的行")
    parser.add_argument("--exclude", nargs="*", default=[], help="去掉名字里含这些词的行")
    parser.add_argument("--min-clicks", type=float, default=30, help="少于这么多链接点击不下结论（初始值，未验证）")
    parser.add_argument("--lpv-rate", type=float, default=0.5, help="点到落地率低于这个值就提示（初始值，未验证）")
    parser.add_argument("--freq", type=float, default=3.0, help="频次达到这个值就提示疲劳（初始值，未验证）")
    args = parser.parse_args()

    rows = load(args.csv_path, args.include, args.exclude)
    if not rows:
        sys.exit("筛完一行都没有，检查 --include / --exclude。")
    total = metrics(rows)
    print("# Meta 广告导出表体检（脚本自动算，结论要人核）\n")
    print(f"- 广告数：{len(rows)}；花费合计：{fmt(total['spend'], '$')}；链接点击 {fmt(total['link_clicks'])}；"
          f"落地页浏览 {fmt(total['lpv'])}；单次点击 {fmt(total['cpc'], '$')}；点到落地率 {fmt(total['lpv_rate'], '%')}；"
          f"每次落地浏览 {fmt(total['cost_lpv'], '$')}\n")
    print("## 先看这几条\n")
    for warning in account_warnings(rows):
        print(f"- {warning}")
    print("\n## 按广告系列\n")
    print(rollup(rows, "campaign"))
    print("\n## 按广告组\n")
    print(rollup(rows, "adset"))
    print("\n## 按广告\n")
    print(table(rows, args))


if __name__ == "__main__":
    main()
