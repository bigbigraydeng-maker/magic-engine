/** 上线签字的业务错误：带 HTTP 状态码和一句人话，路由直接翻译。 */
export class LaunchSignoffError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    message: string,
  ) {
    super(message)
    this.name = 'LaunchSignoffError'
  }
}
