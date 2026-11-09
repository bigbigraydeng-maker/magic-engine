---
id: 2026-10-23-cts-offerings-yaml-stale-price-after-rise
title: CTS 客服 AI 的报价知识库文件没跟上 10-19 那次全团涨价，客人问到涨价后的团期会被报出少 500 的旧价
status: decided
owner: pm
decided_on: 2026-10-23
source: session:8d76116b
verify_how: 查 config/clients/cts/offerings.yaml 里每个团是否已经能按团期分段存价格（不再是一个团一口价），且数值跟 docs/clients/cts/2026-10-19-price-update-and-early-bird.md 的价格表一致
---
10-19 PM 拍板的全团涨价（Signature 团 6 月起出发 +500 等）只改了 ME 团目录（数据库），没有同步改 `config/clients/cts/offerings.yaml`——这个文件是客服自动回复 AI（`src/lib/messenger-agent/`）的报价依据，且这个文件目前每个团只存一个价格，不支持「按团期分段」。结果：客人问到涨价后的团期（如 Silk Road 10/21、Legacy of China 9/3），AI 会把这个旧价当「已确认价格」自信报出，核价闸门（`verifier/policies/cts.ts`）因为参照基准本身是错的，起不到拦截作用——每单可能少收 500 纽币。

PM 2026-10-23 已知会此发现，**决定排专门窗口修，不在本次对话里做**。修复需要先给 `offerings.yaml` 加「按团期分段价格」的数据形状，不是改一个数字就够。
