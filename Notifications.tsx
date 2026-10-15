import { useState } from 'react';
import { api, errText } from '../../lib/api';
import { fmtDateTime } from '../../lib/time';
import { Badge, Button, Empty, ErrorBanner, Spinner, useLoad, useToast } from '../../ui';

interface N { id: string; user_id: string; type: string; status: string; attempts: number; last_error: string | null; send_at: string }
const STATUSES = ['DEAD', 'FAILED', 'PENDING', 'SENT', 'CANCELLED'] as const;

export default function Notifications() {
  const toast = useToast(); const [status, setStatus] = useState<(typeof STATUSES)[number]>('DEAD'); const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(() => api<N[]>(`/admin/notifications?status=${status}`), [status]);
  async function retry(id: string) {
    setBusy(id);
    try { await api(`/admin/notifications/${id}/retry`, { method: 'POST', body: {} }); toast('ok', 'Re-queued.'); reload(); } catch (e) { toast('err', errText(e)); } finally { setBusy(null); }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold text-slate-900">Notifications</h1><p className="text-sm text-slate-500">Emails that exhausted their retries land in “dead” so nothing is lost silently.</p></div>
        <div role="tablist" aria-label="Status" className="flex rounded-lg bg-slate-100 p-1">
          {STATUSES.map((s) => <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-white shadow-sm' : 'text-slate-600'}`}>{s.toLowerCase()}</button>)}
        </div>
      </div>
      {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> : !data?.length ? <Empty title={`No ${status.toLowerCase()} notifications`} /> :
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Type</th><th className="px-4 py-2">Attempts</th><th className="px-4 py-2">Scheduled</th><th className="px-4 py-2">Last error</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.map((n) => (
              <tr key={n.id}>
                <td className="px-4 py-2"><Badge>{n.type.toLowerCase().replace(/_/g, ' ')}</Badge></td><td className="px-4 py-2">{n.attempts}</td>
                <td className="px-4 py-2">{fmtDateTime(n.send_at)}</td><td className="max-w-xs truncate px-4 py-2 text-red-700" title={n.last_error ?? ''}>{n.last_error ?? '—'}</td>
                <td className="px-4 py-2 text-right">{(n.status === 'DEAD' || n.status === 'FAILED') && <Button size="sm" variant="secondary" busy={busy === n.id} onClick={() => retry(n.id)}>Retry</Button>}</td>
              </tr>))}</tbody>
          </table>
        </div>}
    </div>
  );
}
