'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  blankBrochureCard,
  blankBrochureCity,
  blankBrochureNote,
  isBrochureCard,
  type BrochureBlock,
  type BrochureCity,
  type TailorMadeBrochure,
} from '@/lib/tailor-made/brochure-types';
import { createBrochureFromItinerary } from '@/lib/tailor-made/brochure-seed';
import type { TailorMadeRecord } from '@/lib/tailor-made/types';
import BrochureAudit from './BrochureAudit';

/**
 * 画册编辑器。
 *
 * 与行程单编辑器同构：左边填，右边是成品本身（不是「预览图」——
 * 右边那个 iframe 里的 HTML 就是顾问 ⌘P 导出的那份 PDF）。
 *
 * 页数不用管：模板按内容自动分页，一个城市放 3 个还是 9 个景点都排得下。
 */

const PREVIEW_DEBOUNCE_MS = 600;

type LibraryEntry = { key: string; title: string; day: string; body: string; hero: boolean };
type Library = { cities: { city: string; entries: LibraryEntry[] }[] };

export default function BrochureEditor({
  record,
  clientId,
}: {
  record: TailorMadeRecord;
  clientId: string;
}) {
  const [brochure, setBrochure] = useState<TailorMadeBrochure>(
    () => record.brochure ?? createBrochureFromItinerary(record.payload)
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'info' | 'err'; text: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library>({ cities: [] });
  const [instruction, setInstruction] = useState('');
  const [assisting, setAssisting] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  /** 所有修改都走这里，顺带标脏 */
  const edit = useCallback((fn: (draft: TailorMadeBrochure) => void) => {
    setBrochure((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }, []);

  /* ---------------- 素材库 ---------------- */

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/attraction-library`, {
          credentials: 'include',
        });
        if (res.ok) setLibrary((await res.json()) as Library);
      } catch {
        // 素材库拿不到不影响手写，静默降级
      }
    })();
  }, [clientId]);

  /* ---------------- 预览 ---------------- */

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/brochure-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brochure,
            preparedFor: record.end_client_name,
            quoteRef: record.quote_ref,
          }),
          credentials: 'include',
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '预览生成失败');

        const blob = new Blob([await res.text()], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewError(null);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : '预览生成失败');
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [brochure, clientId, record.end_client_name, record.quote_ref]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  /* ---------------- 一句话改写 ---------------- */

  const assist = useCallback(async () => {
    if (!instruction.trim() || assisting) return;
    setAssisting(true);
    setNote(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tailor-made/brochure-assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brochure, instruction }),
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '改写失败');

      const changed: string[] = json.changed ?? [];
      if (changed.length === 0) {
        // 模型没动内容 —— 它多半是在回答问题或拒绝写承诺性内容。
        // 这不是失败，保留输入框里的原话，别让顾问以为系统坏了。
        setNote({ kind: 'info', text: json.note });
        return;
      }

      setBrochure(json.brochure as TailorMadeBrochure);
      setDirty(true);
      setInstruction('');
      setNote({
        kind: 'ok',
        text: `${json.note}（改了 ${changed.length} 处：${changed.slice(0, 3).join('、')}${changed.length > 3 ? '…' : ''}）`,
      });
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : '改写失败' });
    } finally {
      setAssisting(false);
    }
  }, [brochure, clientId, instruction, assisting]);

  /* ---------------- 保存 / 导出 ---------------- */

  const save = useCallback(async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tailor-made/${record.id}/brochure`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brochure }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '保存失败');
      setDirty(false);
      setNote({ kind: 'ok', text: '已保存' });
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [brochure, clientId, record.id]);

  const print = () => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  /* ---------------- 城市 / 卡片操作 ---------------- */

  const addCity = () => edit((d) => { d.cities.push(blankBrochureCity('')); });
  const removeCity = (i: number) => edit((d) => { d.cities.splice(i, 1); });
  const moveCity = (i: number, dir: -1 | 1) =>
    edit((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.cities.length) return;
      [d.cities[i], d.cities[j]] = [d.cities[j], d.cities[i]];
    });

  const addBlock = (ci: number, block: BrochureBlock) =>
    edit((d) => { d.cities[ci].blocks.push(block); });
  const removeBlock = (ci: number, bi: number) =>
    edit((d) => { d.cities[ci].blocks.splice(bi, 1); });
  const moveBlock = (ci: number, bi: number, dir: -1 | 1) =>
    edit((d) => {
      const blocks = d.cities[ci].blocks;
      const j = bi + dir;
      if (j < 0 || j >= blocks.length) return;
      [blocks[bi], blocks[j]] = [blocks[j], blocks[bi]];
    });

  const pageEstimate = useMemo(
    () => 2 + brochure.cities.reduce((n, c) => n + 1 + Math.max(1, Math.ceil(c.blocks.length / 4)), 0) + 1,
    [brochure]
  );

  return (
    <div className="space-y-4">
      {/* 操作条 */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <div className="font-display text-lg font-semibold">
              {brochure.cover.title || <span className="text-gray-400">未命名画册</span>}
            </div>
            <div className="text-xs text-gray-500">
              {record.quote_ref} · 约 {pageEstimate} 页
              <span className="ml-2">
                {saving ? (
                  <span className="text-me-charcoal/50">保存中…</span>
                ) : dirty ? (
                  <span className="text-me-ochre">● 待保存</span>
                ) : (
                  <span className="text-me-charcoal/40">✓ 已保存</span>
                )}
              </span>
            </div>
          </div>

          {note && (
            <span
              className={`text-sm ${
                note.kind === 'ok'
                  ? 'text-green-700'
                  : note.kind === 'info'
                    ? 'text-me-charcoal/70'
                    : 'text-red-600'
              }`}
            >
              {note.text}
            </span>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-me-charcoal px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
          >
            {saving ? '保存中…' : '立即保存'}
          </button>
          <button
            type="button"
            onClick={print}
            className="rounded-md bg-me-ochre px-4 py-2 text-sm font-medium text-white hover:bg-me-ochre/90"
          >
            导出 PDF
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------- 左：表单 ---------- */}
        <div className="space-y-4">
          {/* 撞图体检：同一个城市板块里两张卡片用了同一张图。见 lib/tailor-made/brochure-audit.ts */}
          <BrochureAudit brochure={brochure} />

          <Section
            title="用一句话改"
            hint="内容已经按行程单排好了。想改哪里直接说 —— 「北京那段写长一点」「所有介绍都别用感叹句」「上海标题换成外滩」。"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={instruction}
                placeholder="例如：把每个城市的介绍都缩短到三句话"
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void assist();
                }}
                disabled={assisting}
                className="flex-1 rounded-md border border-black/10 px-3 py-2 text-sm focus:border-me-ochre focus:outline-none disabled:bg-gray-50"
              />
              <button
                type="button"
                onClick={() => void assist()}
                disabled={assisting || !instruction.trim()}
                className="whitespace-nowrap rounded-md bg-me-ochre px-4 py-2 text-sm font-medium text-white hover:bg-me-ochre/90 disabled:bg-gray-300"
              >
                {assisting ? '改写中…' : '改'}
              </button>
            </div>
            <p className="text-[11px] text-me-charcoal/45">
              改完先在右边看一眼，认可了再点「立即保存」。AI 不会自己写进数据库。
              价格、酒店、餐食、车次这些承诺性内容它一律不碰。
            </p>
          </Section>

          <Section title="封面" hint="客户名和报价编号跟着行程单走，这里不用填。">
            <Field label="大标题" value={brochure.cover.title}
              onChange={(v) => edit((d) => { d.cover.title = v; })} />
            <Field label="图上小字" value={brochure.cover.eyebrow}
              onChange={(v) => edit((d) => { d.cover.eyebrow = v; })} />
            <Field label="封面大图 URL" value={brochure.cover.image} mono
              onChange={(v) => edit((d) => { d.cover.image = v; })} />
            <Field label="城市带（逗号分隔）" value={brochure.cover.cities.join(', ')}
              onChange={(v) =>
                edit((d) => {
                  d.cover.cities = v.split(',').map((s) => s.trim()).filter(Boolean);
                })} />
            {brochure.cover.meta.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr] gap-2">
                <Field label="标签" value={m.label}
                  onChange={(v) => edit((d) => { d.cover.meta[i].label = v; })} />
                <Field label="内容" value={m.value}
                  onChange={(v) => edit((d) => { d.cover.meta[i].value = v; })} />
              </div>
            ))}
          </Section>

          <Section title="总览页">
            <Area label="开篇介绍" value={brochure.overview.intro} rows={4}
              onChange={(v) => edit((d) => { d.overview.intro = v; })} />
            <Field label="提示框标题" value={brochure.overview.note.title}
              onChange={(v) => edit((d) => { d.overview.note.title = v; })} />
            <Area label="提示框正文" value={brochure.overview.note.body} rows={3}
              onChange={(v) => edit((d) => { d.overview.note.body = v; })} />
          </Section>

          {brochure.cities.map((city, ci) => (
            <CityEditor
              key={ci}
              city={city}
              index={ci}
              total={brochure.cities.length}
              library={library}
              edit={edit}
              onMove={moveCity}
              onRemove={removeCity}
              onAddBlock={addBlock}
              onRemoveBlock={removeBlock}
              onMoveBlock={moveBlock}
            />
          ))}

          <button
            type="button"
            onClick={addCity}
            className="w-full rounded-lg border border-dashed border-black/20 py-3 text-sm font-bold text-me-charcoal/60 hover:border-me-ochre/50 hover:bg-me-ivory/50"
          >
            + 添加城市
          </button>

          <Section title="结尾页">
            <Area label="正文" value={brochure.closing.body} rows={4}
              onChange={(v) => edit((d) => { d.closing.body = v; })} />
            <Field label="落款" value={brochure.closing.signOff}
              onChange={(v) => edit((d) => { d.closing.signOff = v; })} />
          </Section>

          <Section
            title="图片版权"
            hint="用了 Wikimedia 等 CC 授权图就必须署名 —— 这是要发给付费客户的文件。自家拍的图不用填。"
          >
            {brochure.credits.map((c, i) => (
              <div key={i} className="grid grid-cols-[2fr_2fr_auto] items-end gap-2">
                <Field label="摄影师" value={c.author}
                  onChange={(v) => edit((d) => { d.credits[i].author = v; })} />
                <Field label="许可" value={c.license}
                  onChange={(v) => edit((d) => { d.credits[i].license = v; })} />
                <button type="button" onClick={() => edit((d) => { d.credits.splice(i, 1); })}
                  className="mb-1 rounded border border-black/10 px-2 py-1 text-xs text-gray-600 hover:bg-me-ivory">
                  删除
                </button>
              </div>
            ))}
            <button type="button"
              onClick={() => edit((d) => { d.credits.push({ author: '', license: '' }); })}
              className="rounded border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/70 hover:bg-me-ivory">
              + 添加一条署名
            </button>
          </Section>
        </div>

        {/* ---------- 右：成品 ---------- */}
        <div className="lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
          {previewError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {previewError}
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={previewUrl ?? undefined}
              title="画册预览"
              className="h-full min-h-[70vh] w-full rounded-xl border border-black/10 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CityEditor({
  city, index, total, library, edit, onMove, onRemove, onAddBlock, onRemoveBlock, onMoveBlock,
}: {
  city: BrochureCity;
  index: number;
  total: number;
  library: Library;
  edit: (fn: (d: TailorMadeBrochure) => void) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onRemove: (i: number) => void;
  onAddBlock: (ci: number, block: BrochureBlock) => void;
  onRemoveBlock: (ci: number, bi: number) => void;
  onMoveBlock: (ci: number, bi: number, dir: -1 | 1) => void;
}) {
  const [libOpen, setLibOpen] = useState(false);

  // 素材库按城市名匹配；名字对不上就把整库列出来，总好过让顾问以为库是空的
  const matched = library.cities.find(
    (c) => c.city.toLowerCase() === city.name.trim().toLowerCase()
  );
  const entries = matched?.entries ?? library.cities.flatMap((c) => c.entries);

  return (
    <Section
      title={city.name || `城市 ${index + 1}`}
      action={
        <div className="flex gap-1">
          <IconBtn label="上移" disabled={index === 0} onClick={() => onMove(index, -1)}>↑</IconBtn>
          <IconBtn label="下移" disabled={index === total - 1} onClick={() => onMove(index, 1)}>↓</IconBtn>
          <IconBtn label="删除" onClick={() => onRemove(index)}>✕</IconBtn>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="城市名" value={city.name}
          onChange={(v) => edit((d) => { d.cities[index].name = v; })} />
        <Field label="天数带" value={city.days} placeholder="DAYS 02 – 05"
          onChange={(v) => edit((d) => { d.cities[index].days = v; })} />
      </div>

      <div className="rounded-lg bg-me-ivory/60 p-3">
        <div className="mb-2 text-xs font-black text-me-charcoal/70">整版大图</div>
        <Field label="大图 URL" value={city.hero.image} mono
          onChange={(v) => edit((d) => { d.cities[index].hero.image = v; })} />
        <Field label="景点名" value={city.hero.title}
          onChange={(v) => edit((d) => { d.cities[index].hero.title = v; })} />
        <Field label="图片角标" value={city.hero.caption}
          onChange={(v) => edit((d) => { d.cities[index].hero.caption = v; })} />
        <Area label="介绍" value={city.hero.body} rows={4}
          onChange={(v) => edit((d) => { d.cities[index].hero.body = v; })} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {city.glance.map((g, gi) => (
          <div key={gi}>
            <Field label={g.label || `速览 ${gi + 1}`} value={g.value}
              onChange={(v) => edit((d) => { d.cities[index].glance[gi].value = v; })} />
          </div>
        ))}
      </div>

      {/* 卡片 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black text-me-charcoal/70">
            景点卡片（{city.blocks.length}）
          </span>
          <span className="text-[11px] text-me-charcoal/45">每页 4 张，多了自动翻页</span>
        </div>

        {city.blocks.map((block, bi) => (
          <div key={bi} className="rounded-lg border border-black/10 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-me-charcoal/50">
                {isBrochureCard(block) ? '景点' : '说明面板'}
              </span>
              <div className="flex gap-1">
                <IconBtn label="上移" disabled={bi === 0} onClick={() => onMoveBlock(index, bi, -1)}>↑</IconBtn>
                <IconBtn label="下移" disabled={bi === city.blocks.length - 1} onClick={() => onMoveBlock(index, bi, 1)}>↓</IconBtn>
                <IconBtn label="删除" onClick={() => onRemoveBlock(index, bi)}>✕</IconBtn>
              </div>
            </div>

            {isBrochureCard(block) ? (
              <>
                <Field label="图片 URL" value={block.image} mono
                  onChange={(v) => edit((d) => {
                    const b = d.cities[index].blocks[bi];
                    if (isBrochureCard(b)) b.image = v;
                  })} />
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <Field label="角标" value={block.day} placeholder="Day 04"
                    onChange={(v) => edit((d) => {
                      const b = d.cities[index].blocks[bi];
                      if (isBrochureCard(b)) b.day = v;
                    })} />
                  <Field label="标题" value={block.title}
                    onChange={(v) => edit((d) => {
                      const b = d.cities[index].blocks[bi];
                      if (isBrochureCard(b)) b.title = v;
                    })} />
                </div>
              </>
            ) : (
              <div className="grid grid-cols-[1fr_2fr] gap-2">
                <Field label="小标签" value={block.eyebrow}
                  onChange={(v) => edit((d) => {
                    const b = d.cities[index].blocks[bi];
                    if (!isBrochureCard(b)) b.eyebrow = v;
                  })} />
                <Field label="标题" value={block.title}
                  onChange={(v) => edit((d) => {
                    const b = d.cities[index].blocks[bi];
                    if (!isBrochureCard(b)) b.title = v;
                  })} />
              </div>
            )}

            <Area label="正文（英文）" value={block.body} rows={4}
              onChange={(v) => edit((d) => { d.cities[index].blocks[bi].body = v; })} />
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAddBlock(index, blankBrochureCard())}
            className="rounded border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/70 hover:bg-me-ivory">
            + 景点
          </button>
          <button type="button" onClick={() => onAddBlock(index, blankBrochureNote())}
            className="rounded border border-black/10 px-3 py-1.5 text-xs font-bold text-me-charcoal/70 hover:bg-me-ivory">
            + 说明面板
          </button>
          <button type="button" onClick={() => setLibOpen((v) => !v)}
            className="rounded border border-me-ochre/40 px-3 py-1.5 text-xs font-bold text-me-ochre hover:bg-me-ochre/5">
            {libOpen ? '收起素材库' : `从素材库选（${entries.length}）`}
          </button>
        </div>

        {libOpen && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-black/10 bg-me-ivory/40 p-2">
            {entries.length === 0 ? (
              <p className="p-2 text-xs text-me-charcoal/50">素材库里还没有这个城市的文案。</p>
            ) : (
              entries.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() =>
                    onAddBlock(index, { image: '', day: e.day, title: e.title, body: e.body })
                  }
                  className="block w-full rounded p-2 text-left hover:bg-white"
                >
                  <div className="text-xs font-bold text-me-charcoal">{e.title}</div>
                  <div className="line-clamp-2 text-[11px] text-me-charcoal/55">{e.body}</div>
                </button>
              ))
            )}
            <p className="p-2 text-[11px] text-me-charcoal/45">
              素材库只给文案，图片仍要自己填 —— 用自家拍的图，画册才是你家的。
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ---------------- 小组件 ---------------- */

function Section({
  title, hint, action, children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-black/10 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-me-charcoal">{title}</h2>
          {hint && <p className="mt-1 text-xs text-me-charcoal/55">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-me-charcoal/50">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-md border border-black/10 px-3 py-2 text-sm focus:border-me-ochre focus:outline-none ${mono ? 'font-mono text-xs' : ''}`}
      />
    </label>
  );
}

function Area({
  label, value, onChange, rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-me-charcoal/50">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-black/10 px-3 py-2 text-sm leading-relaxed focus:border-me-ochre focus:outline-none"
      />
    </label>
  );
}

function IconBtn({
  children, label, onClick, disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-black/10 px-2 py-0.5 text-xs text-gray-600 hover:bg-me-ivory disabled:opacity-30"
    >
      {children}
    </button>
  );
}
