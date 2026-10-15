import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { errText } from '../lib/api';
import { Button, Field, inputCls } from '../ui';
import AuthLayout from './AuthLayout';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(email.trim(), password); } catch (x) { setErr(errText(x)); setBusy(false); }
  }
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to manage your appointments.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">{(id) => <input id={id} type="email" autoComplete="username" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(id) => <input id={id} type="password" autoComplete="current-password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Button type="submit" busy={busy} className="w-full">Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">New patient? <Link className="font-medium text-brand-700 hover:underline" to="/register">Create an account</Link></p>
    </AuthLayout>
  );
}
