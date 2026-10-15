import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { errText } from '../lib/api';
import { Button, Field, inputCls } from '../ui';
import AuthLayout from './AuthLayout';

export default function Register() {
  const { register } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', dob: '', allergies: '', chronicConditions: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const body: Record<string, unknown> = { name: f.name.trim(), email: f.email.trim(), password: f.password,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (f.dob) body.dob = f.dob; if (f.allergies.trim()) body.allergies = f.allergies.trim(); if (f.chronicConditions.trim()) body.chronicConditions = f.chronicConditions.trim();
    try { await register(body); } catch (x) { setErr(errText(x)); setBusy(false); }
  }
  return (
    <AuthLayout title="Create your account" subtitle="Your doctor sees allergies and conditions before the visit.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">{(id) => <input id={id} required className={inputCls} value={f.name} onChange={set('name')} />}</Field>
        <Field label="Email">{(id) => <input id={id} type="email" autoComplete="username" required className={inputCls} value={f.email} onChange={set('email')} />}</Field>
        <Field label="Password" hint="At least 8 characters">{(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} required className={inputCls} value={f.password} onChange={set('password')} />}</Field>
        <Field label="Date of birth (optional)">{(id) => <input id={id} type="date" className={inputCls} value={f.dob} onChange={set('dob')} />}</Field>
        <Field label="Allergies (optional)">{(id) => <input id={id} className={inputCls} value={f.allergies} onChange={set('allergies')} />}</Field>
        <Field label="Chronic conditions (optional)">{(id) => <input id={id} className={inputCls} value={f.chronicConditions} onChange={set('chronicConditions')} />}</Field>
        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Button type="submit" busy={busy} className="w-full">Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">Already registered? <Link className="font-medium text-brand-700 hover:underline" to="/login">Sign in</Link></p>
    </AuthLayout>
  );
}
