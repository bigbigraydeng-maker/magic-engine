/** Plain-Chinese notices for the tour-catalog page shell (server-rendered, no client code). */

export const NO_ACCESS_TEXT = '你的账号还没有开通团目录。需要使用请联系 Magic Engine 团队。'
export const SESSION_EXPIRED_TEXT = '登录已过期，请刷新页面重新登录'
export const PAGE_UNAVAILABLE_TEXT = '页面暂时打不开，请稍后再试。'
export const EMPTY_CATALOG_TEXT = '目录还是空的，Magic Engine 团队正在准备，稍后再来。'

/** A calm card: this is an explanation, not an alarm. */
export function CatalogPageNotice(props: { text: string }): JSX.Element {
  return (
    <div
      data-testid="catalog-page-notice"
      className="rounded-xl border border-black/10 bg-white p-6 text-center shadow-sm"
    >
      <p className="text-sm font-black text-me-charcoal">{props.text}</p>
    </div>
  )
}
