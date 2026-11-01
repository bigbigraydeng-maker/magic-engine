/**
 * 对话框只读工具的调用日志。
 *
 * 这三个工具的执行链必须严格只读：不写 action_runs，不调用 insertRun。
 * 只打一行结构化日志（调了哪个工具、读没读到）。日志失败绝不影响工具本身的返回。
 * 不记录返回内容。
 */

export type DialogReadOutcome = 'read' | 'unread' | 'denied'

export function logDialogRead(call: {
  clientId: string
  toolName: string
  outcome: DialogReadOutcome
}): void {
  try {
    console.info(JSON.stringify({
      event: 'zhuge_dialog_read',
      client_id: call.clientId,
      tool: call.toolName,
      outcome: call.outcome,
      read_only: true,
    }))
  } catch (err) {
    try {
      console.warn('[zhuge dialog read] log failed', err instanceof Error ? err.message : '未知错误')
    } catch {
      // 日志坏了也不能改变工具返回。
    }
  }
}
