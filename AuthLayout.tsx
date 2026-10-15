import type { ReactNode } from 'react';
import { BRAND } from '../ui';

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 to-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold"><span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-white/15">✚</span>{BRAND}</div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight">Appointments that don't double-book, and follow-ups that actually happen.</h2>
          <ul className="mt-8 space-y-3 text-brand-100">
            <li>• Pick a slot, hold it for five minutes, confirm with a reason</li>
            <li>• Doctors get a pre-visit brief; you get a plain-language summary once your doctor approves it</li>
            <li>• Medication reminders from the prescription, by email</li>
          </ul>
        </div>
        <p className="text-sm text-brand-100/80">Demo project. Not for real patient data.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
