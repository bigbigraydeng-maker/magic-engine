# Remotion R1：通用「费用包含清单」模板（2026-10-05）

任务书：`docs/specs/2026-10-05-remotion-engine-dev-plan.md` R1（该文件当时在分支 `claude/zen-herschel-6ed7a4`，未并入 main）。范围依据 `content-foundation-trimmed-scope.md`：只搬一个模板，不接流程。

## 做了什么
`scripts/factory-worker/engines/remotion/`：独立 package.json 与锁文件（Remotion 4.0.532 全家精确版本、React 18、zod 3.25.76）；`src/schema.ts`（props 校验）、`src/timing.ts`（节拍→帧数）、`ListReel/PriceScene/components/theme/Root/index`（从 PM 本机工程搬来的版式，客户内容全部换成 props）；`render.mjs`（校验→查素材→打包→渲染，带总超时）；`tools/make-placeholder-assets.mjs`（ffmpeg 占位素材）；测试 3 个文件。

## 取舍
- **不搬**：原模板里的「运营在新西兰 / 超过 25 年」徽章（带客户声明）；其余 5 个模板、地图、飘雪、左/中版式。
- **`defaultProps` 为空**：缺任何 props，`calculateMetadata` 和组件本身都会抛错，不会静默渲出一条别人的内容。
- **根目录配置只加了两条排除**：`tsconfig.json`（不加则在没装本包依赖的环境，例如 CI，会多出 7 个「找不到 remotion」错误——已用只含该目录的临时配置复现）与 `vitest.config.ts`（本包测试是 node:test，被 vitest 收进去只会报「没有测试套件」）。没有改根 package.json / 锁文件 / eslint（`next lint` 只扫 src 等目录，不进 scripts）。
- **Inngest**：无外部副作用、不在任何流程里，按 CLAUDE.md §3 不需要；R2 接 worker 时才需要回执与事件。

## 试跑（1080×1920，成片在 /private/tmp/remotion-r1-trial/out/）
- A：CTS 真实内容（官网 2026-10-05 现场核对：27 天、NZD $10,899 每人双人同住、2027-05-08 与 2027-10-16 出发；含国际机票奥克兰出发、国内机票、4–5 星酒店 24 晚、5 星长江游轮、英文导游），5 条目，带音乐，334 帧 / 11.1 秒，退出码 0。
- B：虚构「Bayline 悉尼公寓看房」，4 条目，无音乐，占位渐变素材与自制 logo，**props 即仓库里的示例文件，一个字没改**，307 帧 / 10.2 秒，退出码 0。
- 两条各抽 9 宫格逐镜检查：文字、价格、logo 完整；B 里没有 CTS 内容漏入。第一轮看图发现两处问题并已修：7 位数价格在价格带里超出右侧安全区（字号现在按字符数自动缩小，9 字符以内与原版一致）；开场行文字超过约 12 字符会折行（上限由 24 收紧到 12）。

## 限制
见包内 README「授权结论与已知限制」。
