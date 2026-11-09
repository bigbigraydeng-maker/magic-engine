/**
 * Google Business Profile OAuth 的共享常量。
 *
 * 为什么单独一个文件：Next App Router 的 `route.ts` 只准导出 HTTP 方法
 * （GET/POST/…）和少量约定字段；导出别的常量会让 Next 生成的路由类型校验报错，
 * 别的路由再 `import ... from '../start/route'` 更是把一个 route 模块当库用。
 * 常量放这里，start / callback / 测试三边取同一份，跟
 * `src/lib/microsoft/mail-oauth.ts` 的做法一致。
 */

/** 申请的 Google 授权范围：读写客户的 Google 商家档案。 */
export const GBP_OAUTH_SCOPE = 'https://www.googleapis.com/auth/business.manage'

/** 防 CSRF 的一次性随机数存在这个 cookie 里，回调时必须对得上。 */
export const GBP_STATE_COOKIE = 'gbp_oauth_state'

/** state cookie 的有效期（秒）。10 分钟。 */
export const GBP_STATE_TTL_SECS = 600
