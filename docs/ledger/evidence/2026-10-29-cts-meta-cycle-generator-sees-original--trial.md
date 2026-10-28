# 证据 · 2026-10-29-cts-meta-cycle-generator-sees-original · 当场试跑

fetched_at: 2026-10-28T11:10:10.548Z（UTC）
方法：本机用真实大模型（标题周循环同一个生成函数 generateMetaCycleTitle）对 3 个 9-28 以来每周都被 fact_contradiction_detected 拦下的 CTS 页面重新生成；硬规则用修复后的版本（品牌词 cts/boying/ctstours/ctsnz 不算事实、数字细节算事实），通过后再跑真实 AI 判官。**只生成，不读写网站、不写库。** 原文取自生产库 cron_run_logs 里 10-19/10-26 那两轮 step4 回执。

结论：3 页全部通过硬规则 + AI 判官（修复前同样三页的拦截原因都是 drops fact(s) — CTS）。

## best-time-to-visit-china
- 原标题：Best Time to Visit China | NZ Seasonal Guide | CTS Tours
- 原描述：When to visit China? Detailed season guide covering weather, crowds, prices for all major regions. Plan your ideal trip.
- 必保事实：NZ；是否重试：否
- 新标题：Best Time to Visit China – NZ Seasonal Guide
- 新描述：Best time to visit China by season. Weather, crowds and pricing guide for all major regions. Plan your NZ trip today.
- 硬规则：pass；AI 判官：no contradiction detected (score 0.30)

## liziba-station-chongqing
- 原标题：Liziba Station Chongqing: Train Through a Building | CTS
- 原描述：Liziba Station in Chongqing is the world's only monorail station built inside a residential tower — trains pass through the 6th floor of a 19-storey building. How to visit, best viewing spots, and how to include it in a Chongqing tour from New Zealand.
- 必保事实：New Zealand, 6th, 19-storey；是否重试：是
- 新标题：Chongqing Liziba Station: Train Through a 19-Storey Building
- 新描述：Liziba Station Chongqing: monorail passes through the 6th floor of a residential tower. Visit from New Zealand with CTS Tours. Plan your trip now.
- 硬规则：pass；AI 判官：no contradiction detected (score 0.28)

## tianmen-mountain-travel-guide
- 原标题：Tianmen Mountain Travel Guide | Heaven's Gate | Cable Car | CTS Tours
- 原描述：Discover Tianmen Mountain's thrills: Heaven's Gate 999-step climb, glass skywalk & cable car views. Expert travel guide for New Zealand visitors to Zhangjiajie's iconic sacred peak.
- 必保事实：New Zealand, 999-step；是否重试：否
- 新标题：Tianmen Mountain Travel Guide for NZ Visitors
- 新描述：Explore Tianmen Mountain near Zhangjiajie with our NZ traveller's guide. Climb the 999-step Heaven's Gate, experience the glass skywalk & cable car views. 
- 硬规则：pass；AI 判官：no contradiction detected (score 0.22)

人工逐句读：三条新文案都保留了原文的具体事实（6th / 19-storey / 999-step / New Zealand），没有新编的价格日期；liziba 新描述里出现了 CTS Tours（品牌语气只禁止标题加品牌后缀，描述不受限）。
