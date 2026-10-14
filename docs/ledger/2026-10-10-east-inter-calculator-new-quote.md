---
id: 2026-10-10-east-inter-calculator-new-quote
title: East Inter 官网运费计算器已换成 10-10 新报价并上线；东际的生效日期还没回
status: done
owner: pm
decided_on: 2026-10-10
source: session:342d4a50
verify_by: 2026-10-14
done_on: 2026-10-10
done_ref: pr:2427
verify_how: 东际回了生效日期并已改页面；官网 eastinter.com.au 计算器悉尼 2 方显示 A$593 且页眉写 CURRENT RATES（拿到生效日期后改成具体月份）；新价格与每公斤计价都已核对。
---
新报价只有海运拼箱变价（下调 50–100 元人民币），其余四张表与旧版逐格相同。源文件在 docs/clients/east-inter/calculator-2026-10/，已部署到 east-inter-demo（外部提交 65b2fdd，回滚目标 d60c23a）。Impeccable 网页检查尚未运行（需先获准下载），待补跑并记录前后数字。
空运大件单位东际答复为每 1 公斤，草稿已改（线上旧版曾高报一倍）。未决：汇率 4.9 沿用；生效月份写 October 2026 是假设，已问东际。
详见 doc:docs/clients/east-inter/2026-10-10-calculator-new-quote-diff.md
Impeccable 已于 10-14 获 PM 许可并跑完（19→6 项，见差异文档第 10 节）。后续（#964 登记）：偏远邮编加价需新增邮编输入框，待 PM 决定。
后续（#964 登记，评审第二轮）：带磁带电大件空运（AU04，经香港/韩国直飞，价格更高）需要在页面加货类选择并配置 AU04 各档费率，目前只在提示里写明估价仅限普货。
