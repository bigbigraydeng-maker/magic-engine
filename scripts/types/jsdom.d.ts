/**
 * jsdom 的最小类型声明 —— 只声明 `scripts/probe-crm-priority-ui.ts` 用到的那一点点。
 *
 * ## 为什么不装 `@types/jsdom`
 *
 * 仓库的「合并闸」把**任何** package.json 改动判成 A 级（引入新依赖 = 供应链面），
 * 于是整个 PR 就得 PM 手动点合并。为一个只在一个探针脚本里用到的类型包，
 * 换来每次都打扰 PM 一次，不值。`jsdom` 本身早就在依赖里（vitest 带的 29.1.1），
 * 缺的只是类型。
 *
 * 顺带一条实测（免得下一个人去装）：DefinitelyTyped **压根没发过 29.x** ——
 * `npm view @types/jsdom versions` 给的是 …27.0.0 / 28.0.0–28.0.3 / 30.0.0，中间是空的。
 * 所以就算要装也只能拿 `^30` 对 `29.1.1`，大版本号本来就对不上。
 *
 * ## 手写声明的风险与边界
 *
 * 手写的声明会跟真库漂移。这里刻意只声明**用到的两个成员**，且只服务
 * `scripts/` 下的探针：漂移了马上就是编译错，不会静默变成 `any`。
 * 哪天有生产代码要用 jsdom，就该正经装类型包、并接受那次 A 级复审。
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; pretendToBeVisual?: boolean })
    readonly window: Window & typeof globalThis
  }
}
