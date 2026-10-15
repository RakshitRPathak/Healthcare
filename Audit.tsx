import { useState } from 'react';
import { api, errText } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';
import { Badge, Empty, ErrorBanner, inputCls, Spinner, useLoad } from '../../ui';

interface A { id: number; at: string; actor_id: string | null; actor_role: string | null; action: string; resource_type: string | null; resource_id: string | null; ip: string | null; request_id: string | null }

export default function Audit() {
  const [action, setAction] = useState('');
  const { data, error, loading, reload } = useLoad(() => api<A[]>(`/admin/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`), [action]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-slate-900">Audit log</h1><p className="text-sm text-slate-500">Append-only. The database refuses edits and deletes, even from the application.</p></div>
        <div><label htmlFor="act" className="mb-1 block text-sm font-medium text-slate-700">Action</label>
          <select id="act" className={`${inputCls} w-56`} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All</option>
            {['auth.login', 'auth.login_failed', 'appointment.book', 'appointment.confirm', 'appointment.cancel', 'appointment.reschedule', 'appointment.no_show', 'appointment.complete', 'summary.read', 'summary.approve', 'leave.create', 'doctor.create', 'calendar.connect', 'notification.retry'].map((a) => <option key={a}>{a}</option>)}
          </select></div>
      </div>
      {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> : !data?.length ? <Empty title="No events" /> :
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Who</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Resource</th><th className="px-4 py-2">Request</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2">{fmtDateTime(r.at)}</td>
                <td className="px-4 py-2">{r.actor_role ? <Badge tone="teal">{r.actor_role.toLowerCase()}</Badge> : <Badge>anonymous</Badge>} <span className="font-mono text-xs text-slate-400">{r.actor_id?.slice(0, 8)}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.resource_type ?? ''} {r.resource_id?.slice(0, 8) ?? ''}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-400">{r.request_id?.slice(0, 8)}</td>
              </tr>))}</tbody>
          </table>
        </div>}
    </div>
  );
}
