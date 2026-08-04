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
  type TailorMadeFlight,
} from '@/lib/tailor-made/types';
import type { ReviewItem } from '@/lib/tailor-made/extract';
import AiComposer, { type ChatTurn } from './AiComposer';
import ReviewPanel, { sectionIdForPath } from './ReviewPanel';

/**
 * Tailor-made 行程单编辑器。
 *
 * 主入口是对话框：顾问把现成的行程文字整段粘进来，AI 转成结构化数据。
 * 下面的逐项表单是**校对面**，不是录入面 —— 没人会为一份 20 天的行程
 * 一格一格地填。默认折叠，AI 标出需要确认的地方时再展开。
 *
 * 右边是行程单本体的实时预览，用的就是最终出 PDF 的那份 HTML，
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
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // AI 对话
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [flightBusy, setFlightBusy] = useState(false);
  const [flightNote, setFlightNote] = useState<string | null>(null);
  const [expandingDay, setExpandingDay] = useState<number | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [heroName, setHeroName] = useState<string | null>(null);
  const [heroChoices, setHeroChoices] = useState<Array<{ name: string; label: string }>>([]);

  // 上传要用最新的 payload：先传航班再传行程时，两次 onChange 之间
  // React state 未必已经提交，闭包里的 payload 可能是旧的 —— 旧的传上去
  // 就会把刚读到的航段冲掉（甲方实测：第一版有航班，重新生成后没了）。
  const payloadRef = useRef(payload);
  useEffect(() => { payloadRef.current = payload; }, [payload]);

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

  /* ---------------- AI 抽取 ---------------- */

  const askAi = useCallback(
    async (message: string) => {
      setAiBusy(true);
      setAiError(null);
      // 先把用户这句放进历史，界面立刻有反馈；失败再回滚
      setTurns((prev) => [...prev, { role: 'user', content: message }]);

      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, current: payload, history: turns }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'AI 解析失败');

        setPayload(data.payload);
        setDirty(true);
        setReview(data.review ?? []);
        setTurns((prev) => [...prev, { role: 'assistant', content: data.reply }]);
        // 有待确认项时自动展开校对面，否则顾问看不到要改哪里
        if ((data.review ?? []).length > 0) setFieldsOpen(true);
      } catch (err) {
        setAiError(err instanceof Error ? err.message : 'AI 解析失败');
        setTurns((prev) => prev.slice(0, -1));
      } finally {
        setAiBusy(false);
      }
    },
    [clientId, payload, turns]
  );

  /**
   * 上传出票单 PDF，读出航段。
   *
   * 航班是另一份文件（Amadeus / 航司出的），以前只能人工照抄进行程 ——
   * 抄错一个航站楼客人就跑错地方。
   */
  const uploadFlights = useCallback(
    async (file: File) => {
      setFlightBusy(true);
      setFlightNote(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`/api/clients/${clientId}/tailor-made/flights`, {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '解析失败');

        edit((d) => {
          d.flights = data.flights as TailorMadeFlight[];
          if (data.bookingRef) d.bookingRef = data.bookingRef;
        });
        setFlightNote(data.note ?? null);
      } catch (err) {
        setFlightNote(err instanceof Error ? err.message : '解析失败');
      } finally {
        setFlightBusy(false);
      }
    },
    [clientId, edit]
  );

  /** 上传每日行程文件（Word / PDF / 纯文本），一次解析成整份行程。 */
  const importSource = useCallback(
    async (file: File) => {
      setImportBusy(true);
      setImportNote(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('current', JSON.stringify(payloadRef.current));
        const res = await fetch(`/api/clients/${clientId}/tailor-made/import`, {
          method: 'POST', body: fd, credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '解析失败');

        setPayload(data.payload);
        setDirty(true);
        setReview(data.review ?? []);
        if (data.heroName) setHeroName(data.heroName);
        setImportNote(data.reply ?? '已导入');
        if ((data.review ?? []).length > 0) setFieldsOpen(true);
      } catch (err) {
        setImportNote(err instanceof Error ? err.message : '解析失败');
      } finally {
        setImportBusy(false);
      }
    },
    [clientId]
  );

  /** 换封面 —— 自动选会猜错，得留个换的入口 */
  const changeHero = useCallback(
    async (name: string) => {
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/heroes?name=${encodeURIComponent(name)}`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '换图失败');
        edit((d) => { d.trip.heroImage = data.dataUri; });
        setHeroName(name);
      } catch { /* 换图失败不打断主流程 */ }
    },
    [clientId, edit]
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/heroes`, { credentials: 'include' });
        if (res.ok) setHeroChoices((await res.json()).choices ?? []);
      } catch { /* 拿不到就不显示换图入口 */ }
    })();
  }, [clientId]);

  /** 把某一天的正文展开写细。返回结果先落到编辑器，顾问看过才保存。 */
  const expandOneDay = useCallback(
    async (index: number, instruction?: string) => {
      setExpandingDay(index);
      try {
        const res = await fetch(`/api/clients/${clientId}/tailor-made/expand-day`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day: payload.days[index], trip: payload.trip, instruction }),
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '展开失败');
        edit((d) => { d.days[index].body = data.body; });
        setNote({ kind: 'ok', text: data.note || '已展开' });
        setTimeout(() => setNote(null), 3000);
      } catch (err) {
        setNote({ kind: 'err', text: err instanceof Error ? err.message : '展开失败' });
      } finally {
        setExpandingDay(null);
      }
    },
    [clientId, payload, edit]
  );

  /** 点「待确认」里的一条，展开校对面并滚到对应区块 */
  const jumpToField = useCallback((path: string) => {
    setFieldsOpen(true);
    const id = sectionIdForPath(path);
    // 等展开动画/渲染完成再滚
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
        setSavedAt(new Date());
        // 状态变更给明确回执；普通自动保存不弹提示，避免每次打字都闪一下
        if (nextStatus) {
          setNote({ kind: 'ok', text: `已保存，状态：${TAILOR_MADE_STATUS_LABEL[nextStatus]}` });
          setTimeout(() => setNote(null), 2500);
        }
      } catch (err) {
        setNote({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
      } finally {
        setSaving(false);
      }
    },
    [payload, record.id, clientId]
  );

  /**
   * 自动保存。
   *
   * 顾问不该需要「想着去点保存」—— 尤其 AI 一次生成 20 天内容要跑十几秒，
   * 那之后所有东西都只在浏览器内存里，关掉标签页就没了。
   * 改动停止 1.5 秒后自动落库；save() 会把 dirty 置回 false，所以不会循环。
   */
  useEffect(() => {
    if (!dirty || saving) return;
    const timer = setTimeout(() => { void save(); }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, saving, save]);

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
              <span className="ml-2">
                {saving
                  ? <span className="text-me-charcoal/50">保存中…</span>
                  : dirty
                    ? <span className="text-me-ochre">● 待保存</span>
                    : savedAt
                      ? <span className="text-[#5C8A4A]">✓ 已自动保存 {savedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                      : <span className="text-me-charcoal/40">✓ 已保存</span>}
              </span>
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
            {saving ? '保存中…' : '立即保存'}
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
        {/* ---------- 左：AI 对话 + 校对 ---------- */}
        <div className="space-y-4">
          {/* 第一步：两份文件。这是甲方描述的真实起点 ——
              「他们会先输入 2 个信息：航班信息 pdf 和每日行程文本文件」。
              以前上传入口埋在「逐项校对」里，等于没有。 */}
          <section className="rounded-xl border border-black/10 bg-white p-5">
            <h2 className="text-sm font-black text-me-charcoal">① 上传两份文件</h2>
            <p className="mt-1 text-xs text-me-charcoal/55">
              上传后系统直接解析出行程和航班，右边立刻能看到成品。不用填表。
            </p>

            <label className={`mt-3 block cursor-pointer rounded-lg border border-dashed border-black/20 p-5 text-center ${(importBusy || flightBusy) ? 'opacity-50' : 'hover:border-me-ochre/50 hover:bg-me-ivory/50'}`}>
              <div className="text-sm font-bold text-me-charcoal">
                {(importBusy || flightBusy) ? '解析中…' : '选择文件上传'}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-me-charcoal/45">
                每日行程（Word / PDF / 文本）和出票单（PDF）都扔这里 —— 系统自己认是哪一种。
                <br />两份都要传，可以一次一份。
              </div>
              <input
                type="file"
                className="hidden"
                disabled={importBusy || flightBusy}
                accept=".docx,.pdf,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSource(f); e.target.value=''; }}
              />
            </label>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-me-charcoal/50">
              <span>行程：{payload.days.length > 1 ? `已读到 ${payload.days.length} 天` : '未上传'}</span>
              <span>
                航班：{(payload.flights?.length ?? 0) > 0
                  ? `已读到 ${payload.flights?.length} 段${payload.bookingRef ? ` · ${payload.bookingRef}` : ''}`
                  : '未上传'}
              </span>
            </div>

            {(importNote || flightNote) && (
              <p className="mt-2 rounded-lg bg-me-ivory/70 px-3 py-2 text-xs leading-relaxed text-me-charcoal/70">
                {[importNote, flightNote].filter(Boolean).join(' · ')}
              </p>
            )}

            {/* 封面：系统按目的地自动选，但一定有猜错的时候，所以明说选了什么并给换的入口 */}
            {heroChoices.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
                <span className="text-xs text-me-charcoal/55">
                  封面：
                  {heroName
                    ? <strong className="ml-1 text-me-charcoal/80">系统选了「{heroChoices.find(c=>c.name===heroName)?.label ?? heroName}」</strong>
                    : <span className="ml-1">默认</span>}
                </span>
                <select
                  value={heroName ?? ''}
                  onChange={(e) => e.target.value && void changeHero(e.target.value)}
                  className="rounded-md border border-black/15 px-2 py-1 text-xs"
                >
                  <option value="">换一张…</option>
                  {heroChoices.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </div>
            )}
          </section>

          <AiComposer onSubmit={askAi} busy={aiBusy} turns={turns} error={aiError} />

          <ReviewPanel
            items={review}
            onJump={jumpToField}
            onDismiss={(i) => setReview((prev) => prev.filter((_, idx) => idx !== i))}
          />

          {/* 校对面：AI 填完之后逐项核对用的，不是录入用的，所以默认折叠 */}
          <button
            type="button"
            onClick={() => setFieldsOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-black/10 bg-white px-5 py-3 text-sm font-bold text-me-charcoal hover:border-me-ochre/40"
          >
            <span>高级 · 逐项校对（{payload.days.length} 天）</span>
            <span className="text-me-charcoal/40">{fieldsOpen ? '收起 ▴' : '展开 ▾'}</span>
          </button>

          <div className={fieldsOpen ? 'space-y-6' : 'hidden'}>
          <Section id="tm-client" title="终端客户与报价">
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

          <Section id="tm-trip" title="行程概览">
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

          <Section id="tm-flights" title={`航班（${payload.flights?.length ?? 0} 段）`}>
            <p className="text-xs text-me-charcoal/55">
              上传航司或 Amadeus 出的出票单 PDF，系统读出航段填进行程单。
              <strong className="text-me-charcoal/75">只照抄不补全</strong> —— 单子上没印的航站楼会留空。
            </p>
            <label className={`inline-block cursor-pointer rounded-md border border-black/15 px-3 py-2 text-sm ${flightBusy ? 'opacity-50' : 'hover:bg-me-ivory'}`}>
              {flightBusy ? '解析中…' : '选择出票单 PDF'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={flightBusy}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFlights(f);
                  e.target.value = '';
                }}
              />
            </label>
            {flightNote && <p className="text-xs text-me-charcoal/60">{flightNote}</p>}

            {(payload.flights ?? []).length > 0 && (
              <div className="space-y-2">
                {(payload.flights ?? []).map((f, i) => (
                  <div key={i} className="rounded-md border border-black/10 p-2.5 text-xs">
                    <div className="font-bold">
                      {f.flightNo} <span className="font-normal text-me-charcoal/50">{f.date}</span>
                      {f.operatedBy && <span className="ml-2 font-normal italic text-me-charcoal/45">{f.operatedBy}</span>}
                    </div>
                    <div className="mt-0.5">
                      {f.departTime} {f.from} → {f.arriveTime}{f.arriveDayOffset} {f.to}
                    </div>
                    <div className="mt-0.5 text-me-charcoal/45">
                      {[f.duration, f.cabin, f.departTerminal && `出发 ${f.departTerminal}`, f.arriveTerminal && `到达 ${f.arriveTerminal}`]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))}
                <Text label="订位号" value={payload.bookingRef ?? ''}
                  onChange={(v) => edit((d) => { d.bookingRef = v; })} />
              </div>
            )}
          </Section>

          <Section
            id="tm-days"
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
                  onExpand={(instruction) => void expandOneDay(i, instruction)}
                  expanding={expandingDay === i}
                />
              ))}
            </div>
          </Section>

          <Section id="tm-pricing" title="价格">
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

          <Section id="tm-terms" title="含 / 不含 / 条款">
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

function Section({ id, title, action, children }: { id?: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border border-black/10 bg-white p-5">
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

function DayCard({ day, index, total, onChange, onMove, onRemove, onExpand, expanding }: {
  day: TailorMadeDay;
  index: number;
  total: number;
  onChange: (patch: Partial<TailorMadeDay>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onExpand: (instruction?: string) => void;
  expanding: boolean;
}) {
  const [instruction, setInstruction] = useState('');
  return (
    <div className="rounded-md border border-black/10 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-display text-lg text-me-ochre">Day {String(day.day).padStart(2, '0')}</span>
        <div className="ml-auto flex gap-1">
          <button type="button" className={ghostBtn} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className={ghostBtn} disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
          {/* 展开：源行程常常一天只有一句「Visit Ciqikou, Liziba…」，
              客人看不出这天在干什么。只扩描述，不加时间/价格/酒店。 */}
          <button type="button" className={ghostBtn} disabled={expanding || !day.body?.trim()}
            title={day.body?.trim() ? '把这天写细一点' : '先写一句正文再展开'}
            onClick={() => onExpand(instruction.trim() || undefined)}>
            {expanding ? '改写中…' : instruction.trim() ? '按要求改写' : '展开描述'}
          </button>
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

        {/* 这一天有特殊安排时，用人话说，别让顾问自己改字 */}
        <input
          className={`${inputCls} text-xs`}
          value={instruction}
          disabled={expanding}
          placeholder="这天要改什么？例如「加一句晚上洪崖洞夜景」「写细一点」"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && instruction.trim() && !expanding) {
              e.preventDefault();
              onExpand(instruction.trim());
            }
          }}
        />
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
