/**
 * 资料库 —— 每个客户一个能下载文件的地方（手册、单页资料、价格表等）。
 *
 * 页面只是外壳：登录由 middleware 拦；谁能看、谁能下载、谁能上传，全部由接口自己判断
 * （/api/clients/[id]/documents），页面隐藏按钮只是体验，不是防护。
 * 设计稿：docs/specs/2026-11-10-client-document-library-v0.1.md
 */
import { DocumentLibrary } from './_components/DocumentLibrary'

export const dynamic = 'force-dynamic'

export default function DocumentsPage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">
      <DocumentLibrary clientId={params.id} />
    </div>
  )
}
