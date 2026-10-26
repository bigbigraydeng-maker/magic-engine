/**
 * Next.js 启动钩子。生产 Render 进程起来后，复用 PUT /api/inngest 登记云端函数。
 * 失败只记一行，不挡住网站启动。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return
  const { scheduleInngestSyncOnBoot } = await import('@/lib/inngest/sync-on-boot')
  scheduleInngestSyncOnBoot(process.env)
}
