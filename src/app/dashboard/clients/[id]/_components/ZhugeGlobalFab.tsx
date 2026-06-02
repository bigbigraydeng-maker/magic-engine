'use client'

import { useState } from 'react'
import { ZhugeDrawer } from './ZhugeDrawer'

export function ZhugeGlobalFab({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-me-charcoal px-4 py-3 text-sm font-black text-white shadow-lg transition-all hover:bg-me-charcoal/85 hover:shadow-xl active:scale-95"
        title="询问诸葛亮"
      >
        <span className="text-base leading-none">🧠</span>
        <span className="hidden sm:inline">诸葛亮</span>
      </button>

      <ZhugeDrawer
        clientId={clientId}
        isOpen={open}
        onClose={() => setOpen(false)}
        onComplete={() => {}}
      />
    </>
  )
}
