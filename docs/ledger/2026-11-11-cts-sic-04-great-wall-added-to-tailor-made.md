---
id: 2026-11-11-cts-sic-04-great-wall-added-to-tailor-made
title: CTS 后台 tailor made 板块新增 SIC-04 长城一日游草稿（类型 SIC，无价格/日期）
status: done
owner: agent
decided_on: 2026-11-11
source: session:3b5a740c
verify_by: 2026-11-13
verify_how: PM 在 CTS 后台 tailor made 打开 CTS-2026-0062，看封面是长城图、封面小字是 Seat-in-coach (SIC) journey、页面里没有价格和日期，就算成
done_on: 2026-11-11
done_ref: pr:3797
---
PM 要求：按产品册「Great Wall Tour (SIC-04)」在 CTS 的 tailor made 板块新增一条，类型为 SIC，封面长城，不含价格和出发日期。
做了：在 CTS 建了草稿 CTS-2026-0062（Great Wall Tour，id 46393670-4836-42fd-a8f9-668947490a58），类型用主干已有的 trip.productType='sic'（别的窗口先合入的「产品类型」开关），封面靠路线 Mutianyu Great Wall 自动命中长城图。内容照产品册英文原文，不含价格、儿童价、每日出发。
更正：我最初把类型写在 meta.productType（与主干不一致，不会生效），发现后改到 trip.productType 并重新保存。
没做：没打开后台页面看实际排版和 PDF；没发给任何客人；列表页没加「类型」列；产品册其余 SIC 产品没建。
