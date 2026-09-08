'use client';

import { useState } from 'react';
import TailorMadeEditor from './TailorMadeEditor';
import BrochureEditor from './BrochureEditor';
import type { TailorMadeRecord } from '@/lib/tailor-made/types';

/**
 * 一份报价单下的两种交付文档。
 *
 * 行程单回答「每天去哪、住哪、多少钱」，画册回答「这些地方长什么样」。
 * 两份发给同一个终端客户，共用客户名和报价编号，所以放在同一个工作区里切换，
 * 而不是两个入口各填一遍。
 *
 * 两个编辑器都保持挂载：画册预览要重新渲染一次要几百毫秒，
 * 顾问来回对照两份文件时不该每次都等。
 */

type Tab = 'itinerary' | 'brochure';

export default function QuoteWorkspace({
  record,
  clientId,
}: {
  record: TailorMadeRecord;
  clientId: string;
}) {
  const [tab, setTab] = useState<Tab>('itinerary');

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-black/10">
        <TabButton active={tab === 'itinerary'} onClick={() => setTab('itinerary')}>
          行程单
        </TabButton>
        <TabButton active={tab === 'brochure'} onClick={() => setTab('brochure')}>
          画册
          {record.brochure ? (
            <span className="ml-1.5 text-[10px] text-[#5C8A4A]">●</span>
          ) : (
            <span className="ml-1.5 text-[10px] text-me-charcoal/30">未创建</span>
          )}
        </TabButton>
      </div>

      <div hidden={tab !== 'itinerary'}>
        <TailorMadeEditor record={record} clientId={clientId} />
      </div>
      <div hidden={tab !== 'brochure'}>
        <BrochureEditor record={record} clientId={clientId} />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold transition ${
        active
          ? 'border-me-ochre text-me-charcoal'
          : 'border-transparent text-me-charcoal/45 hover:text-me-charcoal/70'
      }`}
    >
      {children}
    </button>
  );
}
