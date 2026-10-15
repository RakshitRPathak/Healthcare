import { config } from '../config';

/** Exchanges a Google OAuth `code` for a long-lived refresh token. Injectable so tests never touch Google. */
export interface CalendarOAuth {
  readonly enabled: boolean;
  authUrl(state: string): string;
  exchange(code: string): Promise<{ refreshToken: string }>;
  revoke?(refreshToken: string): Promise<void>;
}

export class GoogleOAuth implements CalendarOAuth {
  get enabled() { return Boolean(config.google.clientId && config.google.clientSecret); }
  authUrl(state: string) {
    const q = new URLSearchParams({
      client_id: config.google.clientId ?? '', redirect_uri: config.google.redirectUri, response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events', access_type: 'offline', prompt: 'consent', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  async exchange(code: string) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ code, client_id: config.google.clientId ?? '', client_secret: config.google.clientSecret ?? '',
                                  redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }) });
    if (!res.ok) throw new Error(`google code exchange ${res.status}`);
    const j = (await res.json()) as any;
    if (!j.refresh_token) throw new Error('google returned no refresh_token');
    return { refreshToken: j.refresh_token as string };
  }
  async revoke(refreshToken: string) {
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) }).catch(() => {});
  }
}
