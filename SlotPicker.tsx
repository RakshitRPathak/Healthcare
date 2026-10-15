import { useState } from 'react';
import { api, errText } from '../lib/api';
import { fmtTime, todayIn } from '../lib/time';
import type { Doctor, Slot } from '../types';
import { ErrorBanner, inputCls, Spinner, useLoad } from '../ui';

/** Date input + grid of free slots for one doctor, shown in the doctor's own time zone. */
export default function SlotPicker({ doctor, onPick, disabledStart, refreshKey = 0 }:
  { doctor: Doctor; onPick: (slot: Slot) => void; disabledStart?: string; refreshKey?: number }) {
  const min = todayIn(doctor.timezone);
  const [date, setDate] = useState(todayIn(doctor.timezone, 1));
  const { data, error, loading, reload } = useLoad(() => api<Slot[]>(`/doctors/${doctor.id}/slots?date=${date}`), [doctor.id, date, refreshKey]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="slot-date" className="mb-1 block text-sm font-medium text-slate-700">Date</label>
          <input id="slot-date" type="date" min={min} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} w-48`} />
        </div>
        <p className="pb-2 text-xs text-slate-500">Times shown in {doctor.timezone} · {doctor.slot_minutes}-minute visits</p>
      </div>
      {error ? <ErrorBanner message={errText(error)} onRetry={reload} /> : loading && !data ? <Spinner /> :
        data && data.length === 0 ? <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No free slots on this day. Try another date.</p> :
        <ul aria-label="Available slots" className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {data?.map((s) => (
            <li key={s.startAt}>
              <button type="button" disabled={s.startAt === disabledStart} onClick={() => onPick(s)}
                className="w-full rounded-lg bg-white px-2 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-500 disabled:opacity-40">
                {fmtTime(s.startAt, doctor.timezone)}</button>
            </li>))}
        </ul>}
    </div>
  );
}
