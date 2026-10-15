import { api, errText } from '../../lib/api';
import { Card, ErrorBanner, Spinner, useLoad } from '../../ui';

interface Stats { appointments: Record<string, number>; notifications: Record<string, number>; users: Record<string, number>; summaries: { kind: string; source: string; count: number }[] }

const Stat = ({ label, value, tone = 'text-slate-900' }: { label: string; value: number; tone?: string }) =>
  <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200"><div className={`text-2xl font-semibold ${tone}`}>{value}</div><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div></div>;

export default function Overview() {
  const { data, error, loading, reload } = useLoad(() => api<Stats>('/admin/stats'));
  if (error) return <ErrorBanner message={errText(error)} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const a = data.appointments, n = data.notifications;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((x, y) => x + y, 0);
  const ai = data.summaries.filter((s) => s.source === 'llm').reduce((x, s) => x + s.count, 0);
  const fb = data.summaries.filter((s) => s.source === 'fallback').reduce((x, s) => x + s.count, 0);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-slate-900">Overview</h1><p className="text-sm text-slate-500">System health at a glance.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Patients" value={data.users.PATIENT ?? 0} /><Stat label="Doctors" value={data.users.DOCTOR ?? 0} />
        <Stat label="Appointments" value={sum(a)} /><Stat label="Confirmed" value={a.CONFIRMED ?? 0} tone="text-emerald-700" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Appointments by status">
          <dl className="space-y-1.5 text-sm">{Object.entries(a).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="capitalize text-slate-600">{k.replace('_', ' ').toLowerCase()}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
        </Card>
        <Card title="Notification delivery">
          <dl className="space-y-1.5 text-sm">{Object.entries(n).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="capitalize text-slate-600">{k.toLowerCase()}</dt><dd className={`font-medium ${k === 'DEAD' && v > 0 ? 'text-red-600' : ''}`}>{v}</dd></div>)}</dl>
          {(n.DEAD ?? 0) > 0 && <p className="mt-3 text-sm text-red-700">Some emails failed permanently. Review them under Notifications.</p>}
        </Card>
      </div>
      <Card title="Summary generation"><p className="text-sm text-slate-600">{ai} AI-drafted · {fb} used the safe fallback template. Doctors approve every patient-facing summary.</p></Card>
    </div>
  );
}
