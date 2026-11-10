---
id: 2026-11-04-cts-trial-found-site-temp-conflict-and-empty-tour-cities
title: 试跑发现两处线上问题：官网「最佳旅行时间」页的 3–4 月气温与气象局和另一官网页对不上；团目录里 Best of China 和 China Panorama 两个团的城市字段是空的
status: decided
owner: agent
decided_on: 2026-11-04
source: session:2620bc63
verify_by: 2026-11-25
verify_how: "打开官网最佳旅行时间页和北京旅行 FAQ 页，核 3 月温度说法是否一致、是否与气象局平均值相符（北京 3 月日最高约 13°C、清晨约 2°C）；查团目录这两个团的 tour_cities 是否已补。哪项仍未改如实写哪项。不成第一步：把两页原文并排贴给 PM，由 PM 指定谁来改"
---
来源：11-04 实时写信线手工试跑，细节见 docs/clients/cts/email-templates/2026-11-04-monthly-predeparture-dec-realtime-drafts-v0.4.md 的 §2 F08 与 §5。
问题一：官网「最佳旅行时间」页写 3–4 月 15–25 °C，另一页写北京 3 月 5–15 °C，气象局平均值显示 3 月城市日最高约 13–16 °C。不知道哪页写错，要官网负责人核。
问题二：团目录里 tour_cities 为空的两个团是 Best of China 和 China Panorama（后者在目录里叫 grand-tour）；信里的路线是读行程文字得来的。
不做：126 号窗口不改官网、不改团目录数据，只记这两处。
