import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SlotPicker from '../../components/SlotPicker';
import { api, ApiError, errText } from '../../lib/api';
import { fmtDateTime, mmss } from '../../lib/time';
import type { Appointment, Doctor, Slot } from '../../types';
import { Button, Card, Empty, ErrorBanner, Field, inputCls, Spinner, useLoad, useToast } from '../../ui';

function HoldPanel({ doctor, hold, onDone, onExpire, onRelease }:
  { doctor: Doctor; hold: Appointment; onDone: () => void; onExpire: () => void; onRelease: () => void }) {
  const toast = useToast();
  const [left, setLeft] = useState(() => new Date(hold.hold_expires_at!).getTime() - Date.now());
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(hold.hold_expires_at!).getTime() - Date.now()), 500);
    return () => clearInterval(t);
  }, [hold.hold_expires_at]);
  useEffect(() => { if (left <= 0) onExpire(); }, [left, onExpire]);
  async function confirm() {
    setBusy(true); setErr('');
    try { await api(`/appointments/${hold.id}/confirm`, { body: { reason: reason.trim() } }); toast('ok', 'Appointment confirmed. A confirmation email is on its way.'); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); if (e instanceof ApiError && e.code === 'HOLD_EXPIRED') onExpire(); }
  }
  return (
    <Card title="Confirm your appointment" className="ring-2 ring-brand-500">
      <p className="text-sm text-slate-600">Dr. {doctor.name} · <strong className="text-slate-900">{fmtDateTime(hold.start_at, doctor.timezone)}</strong></p>
      <p className="mt-2 text-sm" aria-live="off">Slot held for <span data-testid="countdown" className={`font-mono font-semibold ${left < 60_000 ? 'text-red-600' : 'text-brand-700'}`}>{mmss(left)}</span></p>
      <div className="mt-4">
        <Field label="What is the visit about?" hint="Your doctor sees this before the visit." error={err}>
          {(id) => <textarea id={id} rows={3} maxLength={1000} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. recurring headaches for two weeks" />}
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button busy={busy} disabled={reason.trim().length < 3} onClick={confirm}>Confirm appointment</Button>
        <Button variant="ghost" onClick={onRelease}>Release slot</Button>
      </div>
    </Card>
  );
}

export default function Book() {
  const nav = useNavigate(); const toast = useToast();
  const { data: doctors, error, loading, reload } = useLoad(() => api<Doctor[]>('/doctors'));
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [hold, setHold] = useState<Appointment | null>(null);
  const [refresh, setRefresh] = useState(0); const [picking, setPicking] = useState<string | null>(null);

  async function pick(s: Slot) {
    if (!doctor) return; setPicking(s.startAt);
    try { setHold(await api<Appointment>('/appointments/hold', { body: { doctorId: doctor.id, startAt: s.startAt } })); }
    catch (e) { toast('err', errText(e)); setRefresh((n) => n + 1); }
    finally { setPicking(null); }
  }
  async function release() {
    if (!hold) return; const id = hold.id; setHold(null);
    await api(`/appointments/${id}`, { method: 'DELETE' }).catch(() => {}); setRefresh((n) => n + 1);
  }
  const expire = () => { if (hold) { setHold(null); setRefresh((n) => n + 1); toast('err', 'Your 5-minute hold expired. Please choose a slot again.'); } };

  if (loading && !doctors) return <Spinner />;
  if (error) return <ErrorBanner message={errText(error)} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900">Book a visit</h1><p className="text-sm text-slate-500">Choose a doctor, then a time. We hold your slot for 5 minutes while you confirm.</p></div>
      {!doctors?.length ? <Empty title="No doctors yet">An administrator needs to add a doctor first.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <ul aria-label="Doctors" className="space-y-2">
            {doctors.map((d) => (
              <li key={d.id}>
                <button type="button" aria-pressed={doctor?.id === d.id} onClick={() => { setDoctor(d); setHold(null); }}
                  className={`w-full rounded-xl p-4 text-left ring-1 transition ${doctor?.id === d.id ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-slate-200 hover:ring-brand-500'}`}>
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 font-semibold text-brand-700">{d.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                    <span><span className="block font-medium text-slate-900">Dr. {d.name}</span><span className="block text-sm text-slate-500">{d.specialty}</span></span>
                  </div>
                </button>
              </li>))}
          </ul>
          <div className="space-y-6">
            {!doctor ? <Empty title="Select a doctor to see free times" /> : hold ? (
              <HoldPanel doctor={doctor} hold={hold} onRelease={release} onExpire={expire} onDone={() => nav('/appointments')} />
            ) : (
              <Card title={`Dr. ${doctor.name} · ${doctor.specialty}`}>
                <div className={picking ? 'pointer-events-none opacity-60' : ''}><SlotPicker doctor={doctor} onPick={pick} refreshKey={refresh} /></div>
              </Card>)}
          </div>
        </div>)}
    </div>
  );
}
