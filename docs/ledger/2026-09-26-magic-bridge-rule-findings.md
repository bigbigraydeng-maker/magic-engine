---
id: 2026-09-26-magic-bridge-rule-findings
title: Magic Bridge（Meta 广告 AI 客户页）报告按广告去向算留资和私信咨询、不再把私信广告写成没有转化；每日检查判好的单条广告问题由程序按模板写进报告，AI 只讲不判
status: done
owner: agent
decided_on: 2026-09-26
source: session:4bb834a6
done_on: 2026-09-26
done_ref: pr:2049
verify_by: 2026-10-10
verify_how: 合并后下一次有客户（目前是 CTS）生成报告时看三件事：总体结果里写的是发私信咨询/留下联系方式的人数和每位成本（不是「缺乏转化数据」）；第三部分是程序写的「需要留意的广告」（没检查时写明原因，不写「没发现」）；正文里没有「疲劳/饱和」这类 AI 自己下的判断。样本 1 份报告即可判；10/10 前没人生成记「判不了·没人用」
last_checked: 2026-10-26
check_note: 判不了·没人用：meta_ads_ai_analysis_jobs 最新一条是 2026-09-24 09:54 UTC（早于 9-26 合并），合并后到 10-26 没有任何客户生成过报告
---
PM 2026-09-26 授权「B」（本窗口 abc + 小秘书转达 ab）。设计：docs/specs/2026-09-26-magic-bridge-rule-findings-design.md（PR-B 节）。自报 A 级（客户可见），PM 亲合。
依赖 PR-A（#2043，按实扣费，已合并）；页面卡片（C）待 PM 确认，不在本卡。
