import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PostView, PreView, SourceBadge } from '../../components/Summary';
import { useAuth } from '../../auth';
import { api, errText } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';
import type { Appointment, PostContent, PreContent, Summary } from '../../types';
import { Badge, Button, Card, Empty, ErrorBanner, Field, inputCls, Modal, Spinner, StatusBadge, useLoad, useToast } from '../../ui';

function CalendarCard() {
  const { me, refresh } = useAuth(); const toast = useToast();
  const [params, setParams] = useSearchParams(); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = params.get('calendar');
    if (!s) return;
    toast(s === 'connected' ? 'ok' : 'err', s === 'connected' ? 'Google Calendar connected. Upcoming visits will sync.' : s === 'denied' ? 'Calendar access was not granted.' : 'Could not connect Google Calendar.');
    params.delete('calendar'); setParams(params, { replace: true }); void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me!.calendarAvailable && !me!.calendarConnected) return null;
  async function connect() {
    setBusy(true);
    try { window.location.href = (await api<{ url: string }>('/doctors/me/calendar/connect')).url; } catch (e) { toast('err', errText(e)); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { await api('/doctors/me/calendar', { method: 'DELETE' }); await refresh(); toast('ok', 'Google Calendar disconnected.'); } catch (e) { toast('err', errText(e)); } finally { setBusy(false); }
  }
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-medium text-slate-900">Google Calendar {me!.calendarConnected ? <Badge tone="green">connected</Badge> : <Badge>not connected</Badge>}</p>
        <p className="text-sm text-slate-500">Confirmed visits are added to your calendar and removed when cancelled.</p></div>
      {me!.calendarConnected ? <Button variant="secondary" size="sm" busy={busy} onClick={disconnect}>Disconnect</Button> : <Button size="sm" busy={busy} onClick={connect}>Connect</Button>}
    </Card>
  );
}

function BriefModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { data, loading, error } = useLoad(() => api<Summary[]>(`/appointments/${appt.id}/summaries`), [appt.id]);
  const pre = data?.find((s) => s.kind === 'PRE');
  return (
    <Modal title={`Pre-visit brief · ${appt.patient_name}`} onClose={onClose}>
      {loading ? <Spinner /> : error ? <ErrorBanner message={errText(error)} /> : !pre?.content ? <p className="text-sm text-slate-600">The brief is still being prepared. Check back in a moment.</p> :
        <div className="space-y-3"><SourceBadge s={pre} /><PreView c={pre.content as PreContent} /></div>}
    </Modal>
  );
}

interface MedRow { name: string; dosage: string; instructions: string; times: string; days: string }
const blankMed = (): MedRow => ({ name: '', dosage: '', instructions: '', times: '08:00, 20:00', days: '5' });

function CompleteModal({ appt, onClose, onDone }: { appt: Appointment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState(''); const [meds, setMeds] = useState<MedRow[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const upd = (i: number, k: keyof MedRow, v: string) => setMeds(meds.map((m, j) => j === i ? { ...m, [k]: v } : m));
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    const medications = [];
    for (const m of meds) {
      const times = m.times.split(',').map((t) => t.trim()).filter(Boolean);
      if (!times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return setErr(`${m.name || 'A medication'}: times must look like 08:00, 20:00`);
      medications.push({ name: m.name.trim(), dosage: m.dosage.trim(), instructions: m.instructions.trim() || undefined, timesOfDay: times, durationDays: Number(m.days) });
    }
    setBusy(true);
    try { await api(`/appointments/${appt.id}/complete`, { body: { notes: notes.trim(), medications } }); toast('ok', 'Visit completed. A patient summary is being drafted for your review.'); onDone(); }
    catch (x) { setErr(errText(x)); setBusy(false); }
  }
  return (
    <Modal title={`Complete visit · ${appt.patient_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Clinical notes" hint="Used only to draft the patient summary; never emailed.">{(id) => <textarea id={id} required minLength={3} rows={4} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div>
          <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-medium text-slate-700">Prescriptions</h4><Button type="button" size="sm" variant="secondary" onClick={() => setMeds([...meds, blankMed()])}>+ Add medication</Button></div>
          {meds.length === 0 && <p className="text-sm text-slate-500">None. The patient gets reminders only for what you add.</p>}
          <div className="space-y-3">
            {meds.map((m, i) => (
              <fieldset key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3">
                <legend className="sr-only">Medication {i + 1}</legend>
                <input aria-label={`Medication ${i + 1} name`} placeholder="Name" required className={inputCls} value={m.name} onChange={(e) => upd(i, 'name', e.target.value)} />
                <input aria-label={`Medication ${i + 1} dosage`} placeholder="Dosage, e.g. 500mg" required className={inputCls} value={m.dosage} onChange={(e) => upd(i, 'dosage', e.target.value)} />
                <input aria-label={`Medication ${i + 1} times`} placeholder="Times: 08:00, 20:00" required className={inputCls} value={m.times} onChange={(e) => upd(i, 'times', e.target.value)} />
                <input aria-label={`Medication ${i + 1} days`} type="number" min={1} max={60} required className={inputCls} value={m.days} onChange={(e) => upd(i, 'days', e.target.value)} />
                <input aria-label={`Medication ${i + 1} instructions`} placeholder="Instructions (optional)" className={`${inputCls} col-span-2`} value={m.instructions} onChange={(e) => upd(i, 'instructions', e.target.value)} />
                <button type="button" className="col-span-2 text-left text-xs text-red-600 hover:underline" onClick={() => setMeds(meds.filter((_, j) => j !== i))}>Remove</button>
              </fieldset>))}
          </div>
        </div>
        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={busy}>Complete visit</Button></div>
      </form>
    </Modal>
  );
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
function ReviewModal({ appt, onClose, onDone }: { appt: Appointment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api<Summary[]>(`/appointments/${appt.id}/summaries`), [appt.id]);
  const post = data?.find((s) => s.kind === 'POST');
  const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false);
  const c = post?.content as PostContent | null | undefined;
  const [f, setF] = useState({ summary: '', findings: '', instructions: '', followUp: '', whenToSeekCare: '' });
  useEffect(() => { if (c) setF({ summary: c.summary, findings: c.findings, instructions: c.instructions.join('\n'), followUp: c.followUp, whenToSeekCare: c.whenToSeekCare.join('\n') }); }, [c]);
  async function approve() {
    if (!post || !c) return; setBusy(true);
    try {
      await api(`/summaries/${post.id}/approve`, { body: edit ? { content: { ...c, summary: f.summary.trim(), findings: f.findings.trim(), instructions: lines(f.instructions), followUp: f.followUp.trim(), whenToSeekCare: lines(f.whenToSeekCare) } } : {} });
      toast('ok', 'Approved. The patient has been notified.'); onDone();
    } catch (e) { toast('err', errText(e)); setBusy(false); }
  }
  return (
    <Modal title={`Review summary · ${appt.patient_name}`} onClose={onClose}
      footer={c && !post?.approved_at ? <>
        <Button variant="secondary" onClick={() => setEdit(!edit)}>{edit ? 'Preview' : 'Edit'}</Button>
        <Button busy={busy} onClick={approve}>{edit ? 'Save & approve' : 'Approve & send'}</Button></> : undefined}>
      {loading ? <Spinner /> : error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : !c ? (
        <div className="space-y-3"><p className="text-sm text-slate-600">The draft is still being generated.</p><Button size="sm" variant="secondary" onClick={reload}>Refresh</Button></div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2"><SourceBadge s={post!} />{post!.approved_at ? <Badge tone="green">approved</Badge> : <Badge tone="amber">awaiting your approval</Badge>}</div>
          {post!.source === 'fallback' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The AI draft failed, so this is a plain template from your notes. Please check it before approving.</p>}
          {edit ? (
            <div className="space-y-3">
              {([['summary', 'Summary'], ['findings', 'Findings'], ['instructions', 'Instructions (one per line)'], ['followUp', 'Follow-up'], ['whenToSeekCare', 'Seek care if (one per line)']] as const).map(([k, label]) => (
                <Field key={k} label={label}>{(id) => <textarea id={id} rows={k === 'summary' || k === 'instructions' ? 3 : 2} className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>))}
              <p className="text-xs text-slate-500">Medications stay as prescribed.</p>
            </div>) : <PostView c={c} />}
        </div>)}
    </Modal>
  );
}

function Row({ a, tz, onChange }: { a: Appointment; tz: string; onChange: () => void }) {
  const toast = useToast();
  const [modal, setModal] = useState<'brief' | 'complete' | 'review' | null>(null); const [busy, setBusy] = useState(false);
  const started = new Date(a.start_at) <= new Date(); const ended = new Date(a.end_at) <= new Date();
  async function noShow() {
    if (!confirm(`Mark ${a.patient_name} as a no-show?`)) return; setBusy(true);
    try { await api(`/appointments/${a.id}/no-show`, { method: 'POST', body: {} }); toast('ok', 'Marked as no-show.'); onChange(); } catch (e) { toast('err', errText(e)); setBusy(false); }
  }
  const close = () => setModal(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div>
        <div className="flex items-center gap-2"><span className="font-medium text-slate-900">{fmtDateTime(a.start_at, tz)}</span><StatusBadge status={a.status} /></div>
        <p className="text-sm text-slate-700">{a.patient_name}</p>
        {a.reason && <p className="text-sm text-slate-500">“{a.reason}”</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {a.status === 'CONFIRMED' && <Button size="sm" variant="secondary" onClick={() => setModal('brief')}>Pre-visit brief</Button>}
        {a.status === 'CONFIRMED' && started && <Button size="sm" onClick={() => setModal('complete')}>Complete visit</Button>}
        {a.status === 'CONFIRMED' && ended && <Button size="sm" variant="danger" busy={busy} onClick={noShow}>No-show</Button>}
        {a.status === 'COMPLETED' && <Button size="sm" variant="secondary" onClick={() => setModal('review')}>Patient summary</Button>}
      </div>
      {modal === 'brief' && <BriefModal appt={a} onClose={close} />}
      {modal === 'complete' && <CompleteModal appt={a} onClose={close} onDone={() => { close(); onChange(); }} />}
      {modal === 'review' && <ReviewModal appt={a} onClose={close} onDone={() => { close(); onChange(); }} />}
    </li>
  );
}

type Tab = 'upcoming' | 'needs' | 'history';
const TABS: { id: Tab; label: string }[] = [{ id: 'upcoming', label: 'Upcoming' }, { id: 'needs', label: 'Needs attention' }, { id: 'history', label: 'History' }];

export default function Schedule() {
  const { me } = useAuth(); const tz = me!.timezone;
  const [tab, setTab] = useState<Tab>('upcoming');
  const scope = tab === 'needs' ? 'needs_action' : tab === 'history' ? 'past' : 'upcoming';
  const list = useLoad(() => api<Appointment[]>(`/appointments?scope=${scope}&limit=100`), [scope]);
  const needs = useLoad(() => api<Appointment[]>('/appointments?scope=needs_action&limit=100'));   // drives the badge on the tab
  const reload = () => { list.reload(); needs.reload(); };
  // visits that ended and were not completed live under "Needs attention", not in the history
  const rows = tab === 'history' ? list.data?.filter((a) => a.status !== 'CONFIRMED') : list.data;
  const count = needs.data?.length ?? 0;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-slate-900">Schedule</h1><p className="text-sm text-slate-500">Dr. {me!.name} · times in {tz}</p></div>
        <div role="tablist" aria-label="Filter" className="flex rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
              {t.label}{t.id === 'needs' && count > 0 && <span aria-label={`${count} waiting`} className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{count}</span>}</button>))}
        </div>
      </div>
      <CalendarCard />
      {tab !== 'needs' && count > 0 && <button onClick={() => setTab('needs')} className="w-full rounded-lg bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100">
        {count} finished visit{count > 1 ? 's are' : ' is'} waiting to be completed or marked as no-show. <span className="font-medium underline">Review</span></button>}
      {list.error ? <ErrorBanner message={errText(list.error)} onRetry={list.reload} /> : list.loading && !list.data ? <Spinner /> :
        !rows?.length ? <Empty title={tab === 'upcoming' ? 'No upcoming visits' : tab === 'needs' ? 'Nothing needs your attention' : 'No past visits'} /> :
        <ul className="space-y-3">{rows.map((a) => <Row key={a.id} a={a} tz={tz} onChange={reload} />)}</ul>}
    </div>
  );
}
