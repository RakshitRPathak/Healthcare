import { useState } from 'react';
import SlotPicker from '../../components/SlotPicker';
import { PostView, SourceBadge } from '../../components/Summary';
import { useAuth } from '../../auth';
import { api, errText } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';
import type { Appointment, Doctor, PostContent, Slot, Summary } from '../../types';
import { Button, Card, Empty, ErrorBanner, Modal, Spinner, StatusBadge, useLoad, useToast } from '../../ui';

function RescheduleModal({ appt, tz, onClose, onDone }: { appt: Appointment; tz: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: doctors } = useLoad(() => api<Doctor[]>('/doctors'));
  const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const doctor = doctors?.find((d) => d.id === appt.doctor_id);
  async function pick(s: Slot) {
    setBusy(true);
    try { await api(`/appointments/${appt.id}/reschedule`, { body: { startAt: s.startAt } }); toast('ok', 'Appointment moved. We emailed you both.'); onDone(); }
    catch (e) { toast('err', errText(e)); setRefresh((n) => n + 1); setBusy(false); }
  }
  return (
    <Modal title="Reschedule" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-600">Currently <strong>{fmtDateTime(appt.start_at, tz)}</strong> with Dr. {appt.doctor_name}. Your current slot stays yours until the new one is secured.</p>
      {!doctor ? <Spinner /> : <div className={busy ? 'pointer-events-none opacity-60' : ''}><SlotPicker doctor={doctor} onPick={pick} disabledStart={appt.start_at} refreshKey={refresh} /></div>}
    </Modal>
  );
}

function SummaryModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => api<Summary[]>(`/appointments/${appt.id}/summaries`), [appt.id]);
  const post = data?.find((s) => s.kind === 'POST');
  return (
    <Modal title={`Visit summary · Dr. ${appt.doctor_name}`} onClose={onClose}>
      {loading ? <Spinner /> : error ? <ErrorBanner message={errText(error)} /> : !post || !post.content ?
        <p className="text-sm text-slate-600">Your summary is being reviewed by your doctor. You'll get an email when it is ready.</p> : (
        <div className="space-y-3">
          <div className="flex items-center gap-2"><SourceBadge s={post} /><span className="text-xs text-slate-500">Reviewed by your doctor</span></div>
          <PostView c={post.content as PostContent} />
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">This summary does not replace medical advice. If something worries you, contact your doctor.</p>
        </div>)}
    </Modal>
  );
}

function Row({ a, tz, onChange }: { a: Appointment; tz: string; onChange: () => void }) {
  const toast = useToast();
  const [resched, setResched] = useState(false); const [summary, setSummary] = useState(false); const [busy, setBusy] = useState(false);
  const live = a.status === 'CONFIRMED' && new Date(a.start_at) > new Date();
  async function cancel() {
    if (!confirm('Cancel this appointment?')) return;
    setBusy(true);
    try { await api(`/appointments/${a.id}?reason=${encodeURIComponent('Cancelled by patient')}`, { method: 'DELETE' }); toast('ok', 'Appointment cancelled.'); onChange(); }
    catch (e) { toast('err', errText(e)); setBusy(false); }
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div>
        <div className="flex items-center gap-2"><span className="font-medium text-slate-900">{fmtDateTime(a.start_at, tz)}</span><StatusBadge status={a.status} /></div>
        <p className="text-sm text-slate-600">Dr. {a.doctor_name}{a.reason ? ` · ${a.reason}` : ''}</p>
        {a.status === 'CANCELLED_LEAVE' && <p className="mt-1 text-xs text-red-700">Your doctor became unavailable. Please book another time.</p>}
      </div>
      <div className="flex gap-2">
        {a.status === 'COMPLETED' && <Button size="sm" variant="secondary" onClick={() => setSummary(true)}>View summary</Button>}
        {live && <><Button size="sm" variant="secondary" onClick={() => setResched(true)}>Reschedule</Button>
          <Button size="sm" variant="danger" busy={busy} onClick={cancel}>Cancel</Button></>}
      </div>
      {resched && <RescheduleModal appt={a} tz={tz} onClose={() => setResched(false)} onDone={() => { setResched(false); onChange(); }} />}
      {summary && <SummaryModal appt={a} onClose={() => setSummary(false)} />}
    </li>
  );
}

export default function MyAppointments() {
  const { me } = useAuth(); const tz = me!.timezone;
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const { data, error, loading, reload } = useLoad(() => api<Appointment[]>(`/appointments?scope=${tab}&limit=100`), [tab]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-slate-900">My appointments</h1><p className="text-sm text-slate-500">Times shown in {tz}.</p></div>
        <div role="tablist" aria-label="Filter" className="flex rounded-lg bg-slate-100 p-1">
          {(['upcoming', 'past'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{t}</button>))}
        </div>
      </div>
      {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> :
        !data?.length ? <Empty title={tab === 'upcoming' ? 'Nothing coming up' : 'No past visits yet'}>{tab === 'upcoming' ? 'Book a visit and it will show up here.' : ''}</Empty> :
        <ul className="space-y-3">{data.map((a) => <Row key={a.id} a={a} tz={tz} onChange={reload} />)}</ul>}
      <Card className="bg-brand-50 ring-brand-100"><p className="text-sm text-brand-900">Reminders go out by email 24 hours before each visit. After a visit, your doctor reviews a summary before you can see it.</p></Card>
    </div>
  );
}
