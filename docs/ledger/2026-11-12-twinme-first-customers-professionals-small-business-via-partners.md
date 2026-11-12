---
id: 2026-11-12-twinme-first-customers-professionals-small-business-via-partners
title: TwinMe 第一批客户：华人专业人士（个人品牌）+ 本地小商户，主要由 Magic Network 伙伴带来；ME 老客户追加购买不在第一批
status: decided
owner: pm
decided_on: 2026-11-12
source: session:6610c9ad
verify_how: 对照：①产品默认给两类客户两套起步风格（专业人士=图标信息卡，小商户=真实素材+客户素材包）；②客户注册 TwinMe 时能带上伙伴的推荐码，订单和续费能回传给 Magic Network 算佣金；③对外页面承诺与实际能力一致（发布平台数、配音、交付时限）。
---
PM 11-12 在「卖给谁」里回「专业人士 小商户 经销商带来」（我列了四类：专业人士 / 小商户 / 经销商带来 / ME 老客户追加购买，ME 老客户没选）。
由此带出、还没做的：TwinMe ↔ Magic Network 的连接（推荐码归属、订单/续费回传算佣金；Magic Network 是独立系统 bigbigraydeng-maker/magic-network，分润规则 USANA-style）；两类客户的起步风格；对外承诺核对——产品页写「七平台发布」，而目前能做的是 FB/IG 且 Meta 应用未过审，抖音/视频号/小红书要国内手机号或实名微信；产品页「中英文配音」与「客户自己录」不符（11-10 已记）。
**PM 11-12 回「我们收」：** 客户的钱付给 Magic Lab，伙伴拿佣金（不是伙伴收钱再向我们进货）。价格已在 Magic Network 配置里：6 条 NZ$399/月、16 条 NZ$799、30 条 NZ$1,299、60 条 NZ$2,199，加分身一次性 NZ$100（magic-network src/lib/distributor/config.ts）。付款现阶段仍手动（PM 11-11「先手动解决付款」）。由此要做：TwinMe 记每个客户是哪个伙伴带来的、每月实收多少，回传给 Magic Network 算佣金（退款扣回）；TwinMe 套餐档位与 Magic Network 的 videos-6/16/30/60 对齐。
**PM 11-12 回「自己注册」：** 客户在 TwinMe 网站上自己注册，注册时填伙伴的推荐码（归属记在这一步）。由此要做：TwinMe 自己的注册页（邮箱验证、推荐码、选套餐）；注册的客户落在 TwinMe 租户里，不进 ME；推荐码要能核对是有效伙伴（Magic Network 那边的 8 位码）。付款仍手动，开通与付款的先后待定。
**PM 11-12 回「可以免费试 1 条」：** 注册后、付款前可以免费试 1 条视频。我定的实现默认（PM 未逐条点）：每个账号只有 1 条试用；试用条走 1 分钟档；不占套餐额度、记为「试用」单；同样走我们的人质检；防白嫖靠一个账号一条 + 人工质检把关（同一出镜人/同一手机号重复注册的识别以后再做）。试用成片能否直接发布待 PM 定。 **PM 11-12 回「能发」：** 免费试用的那条成片客户可以直接拿去发布，不加水印。
