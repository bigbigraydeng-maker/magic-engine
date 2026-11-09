/**
 * 一个动作是不是人做的？只看一处判据：登录邮箱含 `@`。
 *
 * 系统与 AI 用的写入者标识都不含 `@`：`system` / `system:qualified-buyer` /
 * `ai:conversation-read` / `governed-reply-agent`（这条虽然长得像邮箱，但
 * 客户端从不把它当人；实测生产 CTS 974 条 stage_event 里 944 条是
 * `ai:conversation-read`，全部落到「机器」这一边，见 PR #2000 v1.2 更正）。
 *
 * 全仓只在这里判「谁是人」——PR #2000 软锁、WP3 「上次谁跟的」、写接口守卫
 * 都 import 这个函数，别的地方不许再写「不以 system: 开头」这类近似判据。
 * 那种写法会漏掉 `ai:*`、`governed-reply-agent` 等新前缀，是历史事故的根因。
 */
export function isHumanActor(actor: string | null | undefined): boolean {
  return typeof actor === 'string' && actor.includes('@')
}
