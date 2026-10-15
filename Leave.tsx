import { FormEvent, useState } from 'react';
import { useAuth } from '../../auth';
import { api, ApiError, errText } from '../../lib/api';
import { fmtDateTime, zonedToIso } from '../../lib/time';
import type { Leave } from '../../types';
import { Button, Card, Empty, ErrorBanner, Field, inputCls, Modal, Spinner, useLoad, useToast } from '../../ui';

interface Conflict { id: string; startAt: string; patientId: string }

export default function LeavePage() {
  const { me } = useAuth(); const toast = useToast(); const tz = me!.timezone;
  const { data, error, loading, reload } = useLoad(() => api<Leave[]>('/doctors/me/leaves'));
  const [f, setF] = useState({ from: '', fromTime: '09:00', to: '', toTime: '17:00', reason: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [conflicts, setConflicts] = useState<Conflict[] | null>(null);

  async function save(cancelConflicts: boolean) {
    setBusy(true); setErr('');
    try {
      await api('/doctors/me/leaves', { body: { startsAt: zonedToIso(f.from, f.fromTime, tz), endsAt: zonedToIso(f.to || f.from, f.toTime, tz), reason: f.reason.trim() || undefined, cancelConflicts } });
      toast('ok', cancelConflicts ? 'Leave added. Affected patients were notified.' : 'Leave added.');
      setConflicts(null); setF({ ...f, from: '', to: '', reason: '' }); reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LEAVE_CONFLICTS') setConflicts((e.details as { appointments: Conflict[] }).appointments);
      else setErr(errText(e));
    } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void save(false); };
  async function remove(id: string) {
    try { await api(`/doctors/me/leaves/${id}`, { method: 'DELETE' }); toast('ok', 'Leave removed.'); reload(); } catch (e) { toast('err', errText(e)); }
  }
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900">Leave</h1><p className="text-sm text-slate-500">Block time off. Patients can't book it, and we never cancel anyone without asking you first.</p></div>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card title="Add leave">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">{(id) => <input id={id} type="date" required className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
              <Field label="Start time">{(id) => <input id={id} type="time" required className={inputCls} value={f.fromTime} onChange={(e) => setF({ ...f, fromTime: e.target.value })} />}</Field>
              <Field label="To">{(id) => <input id={id} type="date" className={inputCls} value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
              <Field label="End time">{(id) => <input id={id} type="time" required className={inputCls} value={f.toTime} onChange={(e) => setF({ ...f, toTime: e.target.value })} />}</Field>
            </div>
            <Field label="Reason (optional)">{(id) => <input id={id} maxLength={300} className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            <Button type="submit" busy={busy && !conflicts} className="w-full">Add leave</Button>
          </form>
        </Card>
        <div>
          {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> : !data?.length ? <Empty title="No upcoming leave" /> :
            <ul className="space-y-2">{data.map((l) => (
              <li key={l.id} className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <div><p className="font-medium text-slate-900">{fmtDateTime(l.starts_at, tz)} → {fmtDateTime(l.ends_at, tz)}</p>{l.reason && <p className="text-sm text-slate-500">{l.reason}</p>}</div>
                <Button size="sm" variant="ghost" onClick={() => remove(l.id)}>Remove</Button>
              </li>))}</ul>}
        </div>
      </div>
      {conflicts && (
        <Modal title="This leave overlaps booked visits" onClose={() => setConflicts(null)}
          footer={<><Button variant="secondary" onClick={() => setConflicts(null)}>Go back</Button><Button variant="danger" busy={busy} onClick={() => save(true)}>Cancel {conflicts.length} and notify patients</Button></>}>
          <p className="mb-3 text-sm text-slate-600">Nothing has changed yet. You can adjust the dates, or cancel these appointments (each patient gets an email):</p>
          <ul className="space-y-1 text-sm">{conflicts.map((c) => <li key={c.id} className="rounded-md bg-slate-50 px-3 py-2">{fmtDateTime(c.startAt, tz)}</li>)}</ul>
        </Modal>)}
    </div>
  );
}
