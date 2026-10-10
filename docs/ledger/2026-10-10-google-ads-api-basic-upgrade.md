---
id: 2026-10-10-google-ads-api-basic-upgrade
title: 谷歌广告接口公司名已更正、品牌认证已发布、访问级别升到 Basic，但线上仍跑不通
status: done
owner: pm
decided_on: 2026-10-10
source: pr:2392
done_on: 2026-10-10
done_ref: doc:docs/audits/2026-10-09-google-ads-api-status.md
verify_by: 2026-11-10
verify_how: 对照审计文档 §7-§9 复查：①Ads API centre 公司名仍为 Magic Engine AI Technology Limited、联系邮箱仍为 hello@magicengine.cloud；②Cloud Console 项目 compass-489509 访问级别仍为 Basic 且品牌认证状态仍是已发布；③代码里 googleads.googleapis.com 的版本号是否已从 v17 升级（v17 已于 2025-06-04 关停）；④Render 服务 crazycontent 上五个 GOOGLE_ADS_* 环境变量是否已配（只看键名有无）。任一未动就写明原因并顺延
---
PM 授权后在其 Chrome 里操作：开发者资料公司名由错误主体改为 Magic Engine AI Technology Limited（权威件为 Dropbox 公司文件里的新西兰注册证书），API 联系邮箱改为 hello@magicengine.cloud，均重载整页验证。
PM 本人点击完成品牌认证并发布，访问级别由 Explorer 升到 Basic：生产账户每天 15000 次、全功能，Explorer 下被禁的关键词规划服务随之解除。
但接口仍跑不通，三个硬卡点：代码写死的 API 版本 v17 已关停；刷新令牌不存在且仓库内无任何发起授权的路由；Cloud 项目里没有可用的 OAuth 客户端。
正确顺序：升版本号（派 DeepSeek 写） → 新建 OAuth 客户端 → 跑授权拿刷新令牌 → 填 Render → 当场试跑。本次未改任何生产配置、未建客户端、未读取任何密钥。
按 §11 重新打分仍为 P3，建议等 CTS 谷歌广告恢复投放再做。
