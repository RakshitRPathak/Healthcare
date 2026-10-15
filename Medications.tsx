import { useAuth } from '../../auth';
import { api, errText } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';
import type { Medication } from '../../types';
import { Badge, Empty, ErrorBanner, Spinner, useLoad } from '../../ui';

export default function Medications() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<Medication[]>('/medications'));
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900">Medications</h1><p className="text-sm text-slate-500">Active prescriptions from your doctors, with your next email reminder.</p></div>
      {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> :
        !data?.length ? <Empty title="No active medications">Prescriptions your doctor adds after a visit appear here.</Empty> :
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((m) => (
            <li key={m.id} className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold text-slate-900">{m.name}</h3><p className="text-sm text-slate-600">{m.dosage}</p></div>
                <Badge tone="teal">until {m.end_date}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{m.times_of_day.map((t) => <span key={t} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{t}</span>)}</div>
              {m.instructions && <p className="mt-3 text-sm text-slate-600">{m.instructions}</p>}
              <p className="mt-3 text-xs text-slate-500">Prescribed by Dr. {m.doctor_name}{m.next_reminder_at ? ` · next reminder ${fmtDateTime(m.next_reminder_at, me!.timezone)}` : ''}</p>
            </li>))}
        </ul>}
    </div>
  );
}
