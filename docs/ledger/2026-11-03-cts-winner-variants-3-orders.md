---
id: 2026-11-03-cts-winner-variants-3-orders
title: CTS 赢家视频出 3 条变体（工厂工单 1f77d528 / 45489557 / 4bb9453c），只出到待审
status: decided
owner: agent
decided_on: 2026-11-03
source: session:90a50c3b
verify_by: 2026-11-06
verify_how: 在 content_work_orders 读这 3 张单（编号开头 1f77d528、45489557、4bb9453c）：①是否都到了 in_review 或已 published（没卡在 queued/producing/dead_letter）；②各自 output.maliang_check 的画面自检结果；③PM 是否已审。没出片或卡住，先看出片机（com.magicengine.factory-worker，Ray 的 Mac）是否在跑，再看 dead_letter 原因。出片后若 PM 要投，必须先走素材池批准 + 声明推广期，再按 CTS 组 A 的流程加进广告。
---
PM 2026-11-03：10/18 的「价格悬念」款已证明跑不过现在的 winner（价格大标签款），问视频工厂能不能出 winner 的变体；回「出3条」「是」。
底稿：工单 164a29c1（10/20，已被取代，开场 FROM NZ$2,699 / 10 DAYS 叠黄昏塔镜头 + 居中价格卡 + 3/25 出发）。现在在投的 winner（Meta 视频 尾号5234654）在工厂里查不到对应工单，PM 确认它的样子就是这一路（开头大价格），所以用 164a29c1 做底，不是 winner 本身的原始文件，这是已知偏差。
3 条，每条只改一样：V1 只改开场第三行（10 DAYS → FLIGHTS INCLUDED）；V2 只换配乐（jade_river_journey → horizons-call）；V3 只换团（北京西安 A Tale of Two Cities，From NZ$3,480，镜头用 cd0dea98 已过审的素材）。V3 价格与出发日官网口径不一致（页头 18 March 2027 起价 3,480，出发日表格是 2027-06 起每条 3,680），出片后要 PM 核对才能用。
工厂现状：CTS 154 张单全是 fresh_angle，winner_structures 表为空，从没跑过 variant_from_winner，所以这 3 张按手工单写入（order_type=fresh_angle，angle_source 里写明变体来源）。
