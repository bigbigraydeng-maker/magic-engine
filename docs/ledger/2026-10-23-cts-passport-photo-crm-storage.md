---
id: 2026-10-23-cts-passport-photo-crm-storage
title: CTS 客人护照彩色照片要存进 CRM 客户档案，方便其他功能（如护照到期提醒）调用，具体存放方式由统管设计
status: decided
owner: agent
decided_on: 2026-10-23
source: session:8d76116b
verify_how: 查有没有一张设计稿/PR 把护照照片字段接进客户档案（表结构 + 存储桶 + 权限），以及护照到期提醒等功能有没有真的在读这个字段
---
PM 2026-10-23 拍板：护照彩色照片要写入 CRM 客户档案（不是只存在报名表附件里），这样护照到期提醒之类的功能能调用；**具体存放位置/结构由统管设计**，PM 不管技术细节。
统管建议方向（待正式设计稿）：私有 Supabase Storage bucket（不公开），按客户分路径；CRM 加一张 `customer_documents`（或类似）表存 `customer_id / doc_type=passport / file_url / expiry_date / uploaded_at`，权限限制为该客户的 paid-tier 用户 + ME 内部角色，不对外公开。护照是敏感身份证件，实现时按较高审慎度对待（访问权限、是否加密存储）。
**仍未定、需要 PM 或 CTS 另外回答**：①护照照片留多久（隐私/合规决定，不是技术决策）；②谁来审核护照（有效期/清晰度/是否本人）——这是 CTS 内部岗位分工问题，前面 §2 item 17-18 已记「需要 CTS 说明岗位」，跟这条是同一个缺口。
下一步：排一个窗口出正式设计稿（表结构+存储桶+权限），设计稿里必须明确标出①②两项仍待 PM/CTS 回答，不能自己编一个留存期限。
