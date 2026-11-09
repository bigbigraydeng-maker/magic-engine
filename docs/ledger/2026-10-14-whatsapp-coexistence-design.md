---
id: 2026-10-14-whatsapp-coexistence-design
title: NAL 的 WhatsApp「并存接入」设计稿已写完（只有文档；要过企业认证、应用审核、成为技术提供方、NAL 书面确认几道门才能动手）
status: decided
owner: pm
decided_on: 2026-10-14
source: session:12233466
verify_how: 企业认证通过后（日历 10 月 19、20 日复查），先问 PM 一个问题：NAL 手机上有没有在用问候语、快捷回复、标签、广播列表、Windows 桌面版；再决定是否进入第一个代码 PR（顺序见设计稿第 12 节）
---
设计稿：docs/specs/2026-10-14-whatsapp-embedded-signup-coexistence-v1.md，已过子牙、魏征两审并入修订。
不可逆点：成为技术提供方、一次性的联系人/历史同步（各只能一次）、断开重来；并存会解除 NAL 所有已链接设备。
在这些门全部通过前不写代码、不碰生产、不改任何开关；迁到 Cloud API 不在本稿范围，须 PM 明确说「确认迁移」。
