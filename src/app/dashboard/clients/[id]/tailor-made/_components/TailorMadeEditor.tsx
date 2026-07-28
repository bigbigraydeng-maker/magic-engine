'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  blankDay,
  buildFileName,
  TAILOR_MADE_STATUS_LABEL,
  type TailorMadeDay,
  type TailorMadeItinerary,
  type TailorMadeRecord,
  type TailorMadeStatus,
} from '@/lib/tailor-made/types';

/**
 * Tailor-made 行程单编辑器。
 *
 * 左边填表，右边是行程单本体的实时预览 —— 预览用的就是最终出 PDF 的那份 HTML，
 * 所以顾问不需要「导出看看效果」这一步。
 */

const PREVIEW_DEBOUNCE_MS = 700;

export default function TailorMadeEditor({
  record,
  clientId,
}: {
  record: TailorMadeRecord
  clientId: string
}) {
  const [payload, setPayload] = useState<TailorMadeItinerary>(record.payload);
  const [status, setStatus] = useState<TailorMadeStatus>(record.status);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  /** 任何字段变更都走这里，顺带打脏标记 */
  const edit = useCallback((mutate: (draft: TailorMadeItinerary) => void) => {
    setPayload((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
    setDirty(true);
  }, []);

  /* ---------------- 预览 ---------------- */

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload }),
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
  }, [payload]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  /* ---------------- 保存 ---------------- */

  const save = useCallback(
    async (nextStatus?: TailorMadeStatus) => {
      setSaving(true);
      setNote(null);
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/${record.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, status: nextStatus }),
          credentials: 'include',
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '保存失败');

        if (nextStatus) setStatus(nextStatus);
        setDirty(false);
        setNote({ kind: 'ok', text: nextStatus ? `已保存，状态：${TAILOR_MADE_STATUS_LABEL[nextStatus]}` : '已保存' });
        setTimeout(() => setNote(null), 2500);
      } catch (err) {
        setNote({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
      } finally {
        setSaving(false);
      }
    },
    [payload, record.id, clientId]
  );

  // ⌘S / Ctrl+S 保存 —— 顾问改长行程时会本能地按
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // 有未保存改动时离开页面给个拦截
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const print = () => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  const fileName = useMemo(() => buildFileName(payload), [payload]);

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="space-y-4">
      {/* 操作条 */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <div className="font-display text-lg font-semibold">
              {payload.trip.title || <span className="text-gray-400">未命名行程</span>}
            </div>
            <div className="text-xs text-gray-500">
              {record.quote_ref} · {TAILOR_MADE_STATUS_LABEL[status]}
              {dirty && <span className="ml-2 text-me-ochre">● 有未保存改动</span>}
            </div>
          </div>

          {note && (
            <span className={`text-sm ${note.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{note.text}</span>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-me-charcoal px-4 py-2 text-sm font-medium text-white disabled:bg-gray-300"
          >
            {saving ? '保存中…' : '保存草稿'}
          </button>
          <button
            type="button"
            onClick={print}
            className="rounded-md bg-me-ochre px-4 py-2 text-sm font-medium text-white hover:bg-me-ochre/90"
          >
            导出 PDF
          </button>
          <button
            type="button"
            onClick={() => void save('sent')}
            disabled={saving}
            className="rounded-md border border-black/10 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-me-ivory disabled:opacity-50"
          >
            标记已发送
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------- 左：表单 ---------- */}
        <div className="space-y-6">
          <Section title="终端客户与报价">
            <Grid2>
              <Text label="终端客户称呼" hint="行程单要发给的人，出现在封面 Prepared for" value={payload.client.name}
                onChange={(v) => edit((d) => { d.client.name = v; })} />
              <Text label="出行人数" hint="如 2 adults, twin share" value={payload.client.travellers}
                onChange={(v) => edit((d) => { d.client.travellers = v; })} />
              <Text label="报价编号" value={payload.meta.quoteRef}
                onChange={(v) => edit((d) => { d.meta.quoteRef = v; })} />
              <Text label="出具日期" value={payload.meta.issuedDate}
                onChange={(v) => edit((d) => { d.meta.issuedDate = v; })} />
              <Text label="顾问姓名" value={payload.meta.consultant.name}
                onChange={(v) => edit((d) => { d.meta.consultant.name = v; })} />
              <Text label="顾问职称" value={payload.meta.consultant.title}
                onChange={(v) => edit((d) => { d.meta.consultant.title = v; })} />
              <Text label="顾问电话" value={payload.meta.consultant.phone}
                onChange={(v) => edit((d) => { d.meta.consultant.phone = v; })} />
              <Text label="顾问邮箱" value={payload.meta.consultant.email}
                onChange={(v) => edit((d) => { d.meta.consultant.email = v; })} />
            </Grid2>
          </Section>

          <Section title="行程概览">
            <Text label="行程名称" value={payload.trip.title}
              onChange={(v) => edit((d) => { d.trip.title = v; })} />
            <Text label="城市线" hint="用逗号分隔，如 Beijing, Xi'an, Shanghai" value={payload.trip.route.join(', ')}
              onChange={(v) => edit((d) => { d.trip.route = splitList(v, ','); })} />
            <Grid2>
              <Text label="日期区间" hint="如 8 May – 28 May 2027" value={payload.trip.dateRange}
                onChange={(v) => edit((d) => { d.trip.dateRange = v; })} />
              <Text label="天数" hint="如 20 days" value={payload.trip.duration}
                onChange={(v) => edit((d) => { d.trip.duration = v; })} />
            </Grid2>
            <Area label="行程概述" rows={4} hint="封面后第一段，2–4 句" value={payload.trip.summary}
              onChange={(v) => edit((d) => { d.trip.summary = v; })} />
            <Area label="行程亮点" rows={5} hint="一行一条" value={payload.trip.highlights.join('\n')}
              onChange={(v) => edit((d) => { d.trip.highlights = splitLines(v); })} />
            <Text label="封面图 URL" hint="留空使用默认长城图" value={payload.trip.heroImage}
              onChange={(v) => edit((d) => { d.trip.heroImage = v; })} />

            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">关键事实（概览页六宫格）</div>
              <div className="space-y-2">
                {payload.trip.facts.map((f, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                    <input className={inputCls} value={f.label} placeholder="标题"
                      onChange={(e) => edit((d) => { d.trip.facts[i].label = e.target.value; })} />
                    <input className={inputCls} value={f.value} placeholder="内容"
                      onChange={(e) => edit((d) => { d.trip.facts[i].value = e.target.value; })} />
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section
            title={`逐日行程（${payload.days.length} 天）`}
            action={
              <button type="button" className={ghostBtn}
                onClick={() => edit((d) => { d.days.push(blankDay(d.days.length + 1)); })}>
                + 加一天
              </button>
            }
          >
            <div className="space-y-4">
              {payload.days.map((day, i) => (
                <DayCard
                  key={i}
                  day={day}
                  index={i}
                  total={payload.days.length}
                  onChange={(patch) => edit((d) => { Object.assign(d.days[i], patch); })}
                  onMove={(dir) => edit((d) => { moveDay(d.days, i, dir); })}
                  onRemove={() => edit((d) => { d.days.splice(i, 1); renumber(d.days); })}
                />
              ))}
            </div>
          </Section>

          <Section title="价格">
            <Area label="计价基准" rows={2} value={payload.pricing.basis}
              onChange={(v) => edit((d) => { d.pricing.basis = v; })} />
            <Grid2>
              <Text label="币种" value={payload.pricing.currency}
                onChange={(v) => edit((d) => { d.pricing.currency = v; })} />
              <Text
                label="每人价格"
                hint="留空则显示下方的替代文案"
                value={payload.pricing.amount === null ? '' : String(payload.pricing.amount)}
                onChange={(v) => edit((d) => {
                  const n = Number(v.replace(/[^\d.]/g, ''));
                  d.pricing.amount = v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
                })}
              />
            </Grid2>
            <Text label="未定价时显示" value={payload.pricing.amountNote}
              onChange={(v) => edit((d) => { d.pricing.amountNote = v; })} />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">另需自理的费用</span>
                <button type="button" className={ghostBtn}
                  onClick={() => edit((d) => { d.pricing.optional.push({ label: '', value: '' }); })}>
                  + 加一项
                </button>
              </div>
              <div className="space-y-2">
                {payload.pricing.optional.map((o, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2">
                    <input className={inputCls} value={o.label} placeholder="项目"
                      onChange={(e) => edit((d) => { d.pricing.optional[i].label = e.target.value; })} />
                    <input className={inputCls} value={o.value} placeholder="金额"
                      onChange={(e) => edit((d) => { d.pricing.optional[i].value = e.target.value; })} />
                    <button type="button" className={ghostBtn}
                      onClick={() => edit((d) => { d.pricing.optional.splice(i, 1); })}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="含 / 不含 / 条款">
            <Area label="费用包含" rows={5} hint="一行一条" value={payload.inclusions.join('\n')}
              onChange={(v) => edit((d) => { d.inclusions = splitLines(v); })} />
            <Area label="费用不含" rows={5} hint="一行一条" value={payload.exclusions.join('\n')}
              onChange={(v) => edit((d) => { d.exclusions = splitLines(v); })} />
            <Area label="重要提示" rows={4} hint="一行一条" value={payload.notes.join('\n')}
              onChange={(v) => edit((d) => { d.notes = splitLines(v); })} />
          </Section>

          <Section title="下一步（末页）">
            <div className="space-y-3">
              {payload.nextSteps.map((s, i) => (
                <div key={i} className="space-y-2 rounded-md border border-black/10 p-3">
                  <input className={inputCls} value={s.title} placeholder="标题"
                    onChange={(e) => edit((d) => { d.nextSteps[i].title = e.target.value; })} />
                  <textarea className={inputCls} rows={2} value={s.body} placeholder="说明"
                    onChange={(e) => edit((d) => { d.nextSteps[i].body = e.target.value; })} />
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* ---------- 右：预览 ---------- */}
        <div className="lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>实时预览 —— 与导出的 PDF 完全一致</span>
            <span className="truncate pl-3">{fileName}.pdf</span>
          </div>

          {previewError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{previewError}</div>
          ) : (
            <iframe
              ref={iframeRef}
              src={previewUrl ?? undefined}
              title="行程单预览"
              className="h-[70vh] w-full rounded-md border border-black/10 bg-gray-100 lg:h-full"
            />
          )}

          <p className="mt-2 rounded-md bg-me-ivory p-3 text-xs leading-relaxed text-gray-600">
            <strong>导出 PDF 时请确认打印设置：</strong>边距选「无」，并勾选「背景图形 / Background graphics」。
            打印预览里封面能看到长城照片，就说明设置正确 —— 看不到照片的话导出的文件是残缺的，不要发给终端客户。
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================= 子组件 ================= */

const inputCls =
  'w-full rounded-md border border-black/10 px-3 py-2 text-sm focus:border-me-ochre focus:outline-none focus:ring-1 focus:ring-me-ochre';
const ghostBtn =
  'rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-me-ivory';

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Text({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function Area({ label, value, onChange, rows = 3, hint }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <textarea className={inputCls} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function DayCard({ day, index, total, onChange, onMove, onRemove }: {
  day: TailorMadeDay;
  index: number;
  total: number;
  onChange: (patch: Partial<TailorMadeDay>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-black/10 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-display text-lg text-me-ochre">Day {String(day.day).padStart(2, '0')}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" className={ghostBtn} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className={ghostBtn} disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" className={ghostBtn} onClick={onRemove}>删除</button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={inputCls} value={day.date} placeholder="日期，如 8 May"
            onChange={(e) => onChange({ date: e.target.value })} />
          <input className={inputCls} value={day.weekday} placeholder="星期，如 Saturday"
            onChange={(e) => onChange({ weekday: e.target.value })} />
          <input className={inputCls} value={day.route} placeholder="城市或 A → B"
            onChange={(e) => onChange({ route: e.target.value })} />
        </div>
        <textarea className={inputCls} rows={4} value={day.body} placeholder="当天行程正文"
          onChange={(e) => onChange({ body: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={inputCls} value={day.travel ?? ''} placeholder="交通（可留空）"
            onChange={(e) => onChange({ travel: e.target.value })} />
          <input className={inputCls} value={day.accommodation ?? ''} placeholder="住宿（可留空）"
            onChange={(e) => onChange({ accommodation: e.target.value })} />
          <input className={inputCls} value={day.meals ?? ''} placeholder="餐食（可留空）"
            onChange={(e) => onChange({ meals: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

/* ================= 工具 ================= */

function splitLines(v: string): string[] {
  return v.split('\n').map((s) => s.trim()).filter(Boolean);
}

function splitList(v: string, sep: string): string[] {
  return v.split(sep).map((s) => s.trim()).filter(Boolean);
}

function renumber(days: TailorMadeDay[]): void {
  days.forEach((d, i) => { d.day = i + 1; });
}

function moveDay(days: TailorMadeDay[], index: number, dir: -1 | 1): void {
  const target = index + dir;
  if (target < 0 || target >= days.length) return;
  [days[index], days[target]] = [days[target], days[index]];
  renumber(days);
}
