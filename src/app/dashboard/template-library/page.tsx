import { templateLibraryView } from '@/lib/factory/template-library/present'
import { LibraryPage } from './_components/LibraryPage'

export const metadata = { title: '模板库 · Magic Engine' }

/** Admin-only gallery. The dashboard layout already requires a signed-in admin. */
export default function TemplateLibraryPage() {
  return <LibraryPage view={templateLibraryView()} />
}
