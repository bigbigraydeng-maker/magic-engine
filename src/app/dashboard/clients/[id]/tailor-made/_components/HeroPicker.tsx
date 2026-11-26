'use client';

import { useState } from 'react';

type HeroChoice = { name: string; label: string };

/**
 * 换封面：缩略图点选。
 *
 * 以前是一个只有文字的下拉框，四十多个「北京 · 胡同」「北京 · 天坛」
 * 顾问得一张张换上去才知道长什么样。改成小图网格，看一眼就能挑。
 */
export default function HeroPicker({
  clientId,
  choices,
  current,
  onPick,
}: {
  clientId: string;
  choices: HeroChoice[];
  current: string | null;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentLabel = choices.find((c) => c.name === current)?.label ?? current;
  const thumbUrl = (name: string) =>
    `/api/clients/${clientId}/tailor-made/heroes?thumb=${encodeURIComponent(name)}`;

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        {current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl(current)}
            alt=""
            className="h-10 w-16 rounded-md object-cover ring-1 ring-black/10"
          />
        )}
        <span className="text-xs text-me-charcoal/55">
          封面：
          {current
            ? <strong className="ml-1 text-me-charcoal/80">系统选了「{currentLabel}」</strong>
            : <span className="ml-1">默认</span>}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-black/15 px-2.5 py-1 text-xs text-me-charcoal/80 hover:bg-me-ivory"
        >
          {open ? '收起' : '换一张…'}
        </button>
      </div>

      {open && (
        <ul className="mt-3 grid max-h-[22rem] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
          {choices.map((c) => {
            const selected = c.name === current;
            return (
              <li key={c.name}>
                <button
                  type="button"
                  onClick={() => { onPick(c.name); setOpen(false); }}
                  aria-pressed={selected}
                  className={`group block w-full overflow-hidden rounded-lg bg-white text-left ring-1 transition ${
                    selected ? 'ring-2 ring-me-ochre' : 'ring-black/10 hover:ring-black/30'
                  }`}
                >
                  <span className="block aspect-[8/5] overflow-hidden bg-me-ivory">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbUrl(c.name)}
                      alt={c.label}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </span>
                  <span className="block truncate px-2 py-1.5 text-[11px] leading-tight text-me-charcoal/75">
                    {c.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
