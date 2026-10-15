import { FormEvent, useState } from 'react';
import { api, errText } from '../../lib/api';
import type { Doctor } from '../../types';
import { Button, Card, ErrorBanner, Field, inputCls, Spinner, useLoad, useToast } from '../../ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Doctors() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api<Doctor[]>('/doctors'));
  const blank = { name: '', email: '', password: '', specialty: '', slot: '30', tz: 'Asia/Kolkata', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] };
  const [f, setF] = useState(blank); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api('/admin/doctors', { body: { name: f.name.trim(), email: f.email.trim(), password: f.password, specialty: f.specialty.trim(), slotMinutes: Number(f.slot), timezone: f.tz,
        workingHours: f.days.map((weekday) => ({ weekday, start: f.start, end: f.end })) } });
      toast('ok', `Dr. ${f.name} added.`); setF(blank); reload();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  }
  const toggle = (d: number) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() });
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900">Doctors</h1></div>
      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <Card title="Add a doctor">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Name">{(id) => <input id={id} required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Email">{(id) => <input id={id} type="email" required className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <Field label="Initial password" hint="At least 8 characters">{(id) => <input id={id} type="password" minLength={8} required autoComplete="new-password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
            <Field label="Specialty">{(id) => <input id={id} required className={inputCls} value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />}</Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Visit length (min)">{(id) => <input id={id} type="number" min={5} max={240} step={5} required className={inputCls} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} />}</Field>
              <Field label="Time zone">{(id) => <input id={id} required className={inputCls} value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} />}</Field>
              <Field label="Works from">{(id) => <input id={id} type="time" required className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
              <Field label="Until">{(id) => <input id={id} type="time" required className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>
            </div>
            <fieldset><legend className="mb-1 text-sm font-medium text-slate-700">Working days</legend>
              <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => (
                <label key={d} className={`cursor-pointer rounded-md px-2.5 py-1 text-sm ring-1 ${f.days.includes(i) ? 'bg-brand-50 text-brand-700 ring-brand-500' : 'bg-white text-slate-600 ring-slate-300'}`}>
                  <input type="checkbox" className="sr-only" checked={f.days.includes(i)} onChange={() => toggle(i)} />{d}</label>))}</div></fieldset>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            <Button type="submit" busy={busy} disabled={!f.days.length} className="w-full">Add doctor</Button>
          </form>
        </Card>
        <div>
          {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> :
            <ul className="space-y-2">{data?.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <div><p className="font-medium text-slate-900">Dr. {d.name}</p><p className="text-sm text-slate-500">{d.specialty}</p></div>
                <p className="text-xs text-slate-500">{d.slot_minutes} min · {d.timezone}</p>
              </li>))}</ul>}
        </div>
      </div>
    </div>
  );
}
