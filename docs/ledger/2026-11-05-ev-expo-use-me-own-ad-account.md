---
id: 2026-11-05-ev-expo-use-me-own-ad-account
title: EV Expo 冲刺改用 ME 自己的广告户「Magic Engine」投放，不再等客户共享广告账户
status: decided
owner: pm
decided_on: 2026-11-05
source: session:72cde643
verify_by: 2026-11-06
verify_how: 建草稿前核对「Magic Engine」户（尾号8494）每日可花额度和账户级花费上限；确认购买目标还是改落地页浏览；没核完不开投
---
PM 11-05 拍板：EV Expo 冲刺广告用 ME 自己的广告户 尾号8494，ME 的卡付 Meta，不再用客户的户，也不另开新户。
11-05 只读核实：该户状态正常、有付款卡、币种新西兰元、累计花费 NZ$778；MagicEngine 系统用户有管理广告和素材权限；客户主页已在「NZ EV Tech Expo」业务资产组。
新户测试没做完（建表单走到最后一步前被权限检查拦下，没提交，没建出任何东西）；ME 的业务资产组整理没做（同样被拦，PM 选跳过）。
未核实：账户级花费上限、每日可花额度；ME 户里没有 Eventbrite 的买票像素，「购买」目标要么拿到 Squid 像素共享，要么改选落地页浏览或点击。
开投仍只认 PM 本人回「开投」。
11-06 接入新 ME 的 Meta 侧准备（已做、已核对）：EV Expo 主页对 ME 公司的权限已移除重申请为完全访问；新建专用系统用户 EVExpo（尾号5144，Employee），只分配 EV Expo 主页（内容/社群动态/消息和通话/广告/成效分析/潜在客户）和广告户 Magic Engine（管理广告/查看表现/管理素材），碰不到其他客户；新应用 尾号4982 已关联到 ME 公司并加了 Messenger、Instagram 图谱 API（原有 Facebook 登录、市场营销 API）；Jundong Xia 已是主页完全控制管理员（已接受）。
11-06 门户接入已完成：PM 亲手生成令牌和取应用密钥并粘进门户（令牌和密钥不进聊天不进文件）；首次令牌缺 ads_read 致广告户被拒，重生成后主页和广告户都显示已接入。Instagram 未接入。接入手册见 docs/sops/2026-11-06-new-me-meta-channel-onboarding-fde-v0.1.md。
待办：EVExpo 系统用户对广告户和应用的权限被 PM 改成了「完全访问」，应改回「部分」（最小权限）。
11-06 清零：ME 广告户（Magic Engine）里原有 3 条 Roman 房源「30 Kiteroa」广告系列（累计花费 NZ$778.30，其中 2 条仍显示投放中）混进了 EV Expo 门户的广告页。PM 决定永久删除，并由 PM 本人在 Meta 广告管理工具里删除（自动权限检查拦了助手）。助手事后只读核对：该广告户广告系列为空，EV Expo 门户「我的广告」显示暂无广告。Roman 这 3 条的历史数据已不可恢复。
11-08 PM 确认：ME25 / IN25 折扣码没有实施，原方案「只认 Eventbrite 折扣码报表算 ROI」的真账本不存在；广告 11-06 起已在投、全部按链接点击优化，体检见 docs/clients/ev-tech-expo/2026-11-08-meta-ads-review.md。PM 改为请网站设计公司在官网加装 GA4（另开窗口跟进）；11-05 筹备清单曾因官网已有 GA4（G-YR0BVY2DX5）决定不加装，这次是 PM 改口。
11-08 已建 ME 自己的 GA4 媒体资源「NZ EV Tech Expo – ME」：衡量编号 G-G6SYRV7QSC，数据流 evtechexpo（尾号9796），谷歌分析账号 Magic Engine（404877133），用 PM 的 bigbigraydeng@gmail.com 登录建（hello 在该账号无新建权限）；官网尚未安装，等 PM 点头后发 Glenn 邮件。追踪方案以 docs/clients/ev-tech-expo/2026-11-08-tracking-utm-design-v2.md 为准（v1 作废）。
待办（俊东）：EV Expo 工作台 MTC 额度为 0；内容页没有手动新建发布入口；以及一个广告户被多个客户共用时门户会互相显示广告，需要按客户过滤或用专用广告户。WhatsApp 新号码 11-07 到：新应用的可用产品里没有 WhatsApp，可能要改用 Magic Engine Messaging（尾号8250）或另行处理，未核实。
