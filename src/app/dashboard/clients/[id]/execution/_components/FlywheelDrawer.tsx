'use client'

/**
 * FlywheelDrawer — 飞轮执行抽屉
 *
 * P12.A.5: 壳结构 — 按 mode 显示元信息，关闭按钮可用。
 * P12.A.6: 填充 adapter.execute() 调用，落库 flywheel_actions。
 */

import type { ExecutionItem } from '@/types/diagnostic'
import type { ExecutionTarget } from '@/lib/flywheel/adapters/types'

const FLYWHEEL_LABELS: Record<string, string> = {
  seo:    'SEO 引擎',
  geo:    'GEO Composer',
  ads:    '广告工作台',
  social: '社媒矩阵',
}

interface Props {
  clientId: string
  item: ExecutionItem
  target: ExecutionTarget
  onClose: () => void
}

export function FlywheelDrawer({ item, target, onClose }: Props) {
  const flywheelLabel = FLYWHEEL_LABELS[target.flywheel] ?? target.flywheel

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">
              在 {flywheelLabel} 中执行
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="关闭抽屉"
          >
            ×
          </button>
        </div>

        {/* 正文 — P12.A.6 填充执行逻辑 */}
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-3">
            <p className="text-4xl">🚀</p>
            <p className="text-sm font-medium text-gray-700">执行功能即将上线</p>
            <p className="text-xs text-gray-400 max-w-xs mx-auto">
              P12.A.6 将在此处添加"执行"按钮 — 点击后自动写入 flywheel_actions 记录
            </p>
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-left text-xs space-y-1 mt-4 border border-gray-100">
              <p><span className="text-gray-400">飞轮：</span><strong className="text-gray-800">{target.flywheel}</strong></p>
              <p><span className="text-gray-400">模式：</span><strong className="text-gray-800">{target.mode}</strong></p>
              {target.vendor && (
                <p><span className="text-gray-400">Vendor：</span><strong className="text-gray-800">{target.vendor}</strong></p>
              )}
              {target.action_type && (
                <p><span className="text-gray-400">Action：</span><strong className="text-gray-800">{target.action_type}</strong></p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
