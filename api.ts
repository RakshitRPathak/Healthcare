const BASE = import.meta.env.VITE_API_URL ?? '/api';
const KEY = 'ham.token';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const tokenStore = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; headers?: boolean } = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch { throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.'); }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && json?.error?.code === 'UNAUTHENTICATED') onUnauthorized();
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  }
  return json;
}

/** Friendly text for the error codes the server returns. */
const FRIENDLY: Record<string, string> = {
  SLOT_ALREADY_BOOKED: 'Someone just took that slot. Please pick another time.',
  PATIENT_TIME_CONFLICT: 'You already have an appointment at that time.',
  DOCTOR_ON_LEAVE: 'The doctor is on leave at that time.',
  HOLD_EXPIRED: 'Your 5-minute hold expired. Please choose the slot again.',
  INVALID_CREDENTIALS: 'That email and password do not match.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Please wait a few minutes and try again.',
  EMAIL_TAKEN: 'An account with that email already exists.',
  NOT_RESCHEDULABLE: 'This appointment can no longer be rescheduled.',
  SAME_SLOT: 'That is already your current time.',
  NOT_ENDED: 'The appointment has not ended yet.',
};
export const errText = (e: unknown) => e instanceof ApiError ? (FRIENDLY[e.code] ?? e.message) : 'Something went wrong.';
