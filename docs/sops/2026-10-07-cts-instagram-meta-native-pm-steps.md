# CTS Instagram 改走 Meta 官方接口：PM 要做的步骤（暂缓中）

状态：暂缓。恢复条件：PM 在手机 Instagram 里把 chinatravelservices 改成专业账号，并关联到 CTS Tours 的 Facebook 主页。
查证结论（2026-10-07，只读）：CTS 主页目前没有关联 Instagram；ME 现有授权都没有 Instagram 发布权限；标准访问就够，不需要应用审核，企业认证卡住不影响。

## 第 1 步：改成专业账号
- 做什么：个人号发不了 Reel，必须是商业或创作者账号。
- 怎么做：手机 Instagram 登录 chinatravelservices → 设置 → 账号类型和工具 → 切换为专业账号 → 选「商业」。已经是专业号就跳过。

## 第 2 步：关联到 CTS 的 Facebook 主页
- 做什么：不关联，接口找不到这个 Instagram 账号。
- 怎么做：打开 https://www.facebook.com/profile.php?id=1616575215312482 → 设置 → 已关联账号 → Instagram → 连接 → 登录 chinatravelservices → 确认。
- 菜单名称未逐个点开验证；界面叫法不同时，找「关联 Instagram」。

## 第 3 步：看主页有没有「发布授权」提示
- 做什么：主页要求 Page Publishing Authorization 又没完成，Instagram 发布会被拒。
- 怎么做：同一个主页设置里找「Page Publishing Authorization」，有「去完成」就按提示做完，没有就跳过。

## 第 4 步：授权（等「连接 Instagram 发布」按钮上线后才做；按钮目前没有开发）
- 做什么：给 ME 一个只用于发 Instagram 的独立授权，不改动、不替换现有 Facebook 授权。
- 怎么做：用 Ray 本人的 Facebook 登录 → 只勾 CTS Tours 一个主页、chinatravelservices 一个 Instagram 账号 → 权限项保持默认全选，不取消任何一项。

## 恢复后的开发范围（备忘，现在不做）
沿用已合并的 Instagram 草稿默认和三道开关，把发布适配器的 Publer 层换成 Meta 官方接口；授权用独立新用途；Publer 代码先并存、满 30 天再删。风险级 A，保持草稿，PM 回「合」。
