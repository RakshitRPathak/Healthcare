import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AuthProvider, useAuth } from '../src/auth';
import { ToastProvider } from '../src/ui';
import { tokenStore } from '../src/lib/api';

type Handler = (body: any, url: URL) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;
/** Route-table fetch mock: keys are "METHOD /path" (path without query). Unmatched calls fail the test loudly. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: any; url: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://x'); const method = init.method ?? 'GET';
    const key = `${method} ${url.pathname.replace(/^\/api/, '')}`;
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ key, body, url: url.pathname + url.search });
    const h = routes[key];
    if (!h) throw new Error(`unmocked request: ${key}`);
    const r = await h(body, url);
    const status = r.status ?? 200;
    return { ok: status < 400, status, headers: new Headers(), json: async () => r.json ?? null } as unknown as Response;
  }));
  return calls;
}
export const err = (status: number, code: string, message = code, details?: unknown) => ({ status, json: { error: { code, message, details } } });

export const patient = { id: 'p1', email: 'p@x.test', role: 'PATIENT', name: 'Priya', timezone: 'Asia/Kolkata' };
export const doctorMe = { id: 'd1', email: 'd@x.test', role: 'DOCTOR', name: 'Asha Rao', timezone: 'Asia/Kolkata', specialty: 'GP', slotMinutes: 30, calendarConnected: false, calendarAvailable: false };

/** Standalone pages assume a signed-in user; hold rendering until /me has loaded (like the real shell does). */
function Gate({ children }: { children: ReactElement }) { const { me, loading } = useAuth(); return loading || (!me && tokenStore.get()) ? null : children; }

export function renderApp(ui: ReactElement, opts: { path?: string; token?: string } = {}) {
  if (opts.token) tokenStore.set(opts.token); else tokenStore.clear();
  return render(<MemoryRouter initialEntries={[opts.path ?? '/']}><ToastProvider><AuthProvider><Gate>{ui}</Gate></AuthProvider></ToastProvider></MemoryRouter>);
}
