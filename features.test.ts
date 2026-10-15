import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import YAML from 'yaml';
import { readFileSync } from 'node:fs';
import { config } from '../src/config';
import { decryptSecret, encryptSecret } from '../src/crypto';
import { createThrottle } from '../src/throttle';
import { syncCalendar } from '../src/services/calendarSync';
import { processNotification } from '../src/services/notifications';
import { adminToken, auth, createDoctor, createPatient, FakeMailer, FakeOAuth, makeApp, pool, resetDb, slot } from './helpers';

beforeEach(resetDb);
const book = (api: any, p: any, doctorId: string, startAt: string) =>
  api().post('/appointments').set(auth(p.token)).send({ doctorId, startAt, reason: 'check-up please' });

describe('reschedule', () => {
  it('moves the appointment atomically, keeps one live booking, and emails "moved" not "confirmed"', async () => {
    const { api, jobs } = makeApp(); const doc = await createDoctor(); const p = await createPatient();
    const a = await book(api, p, doc.id, slot(3, 10)); expect(a.status).toBe(201);
    const r = await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(3, 14) });
    expect(r.status).toBe(200); expect(r.body.id).not.toBe(a.body.id); expect(r.body.status).toBe('CONFIRMED');
    const rows = (await pool.query('SELECT id,status,start_at FROM appointments ORDER BY created_at')).rows;
    expect(rows.map((x) => x.status)).toEqual(['CANCELLED', 'CONFIRMED']);
    const moved = (await pool.query(`SELECT user_id FROM notifications WHERE type='APPT_RESCHEDULED'`)).rows;
    expect(moved.map((m) => m.user_id).sort()).toEqual([doc.id, p.id].sort());
    expect((await pool.query(`SELECT count(*)::int n FROM notifications WHERE type='APPT_REMINDER' AND status<>'CANCELLED' AND appointment_id=$1`, [a.body.id])).rows[0].n).toBe(0);
    expect(jobs.calendars).toContain(a.body.id); expect(jobs.calendars).toContain(r.body.id);
    expect(jobs.summaries.some(([id, k]) => id === r.body.id && k === 'PRE')).toBe(true);
  });

  it('target slot taken -> 409 and the original booking is untouched', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient(); const other = await createPatient();
    const a = await book(api, p, doc.id, slot(3, 10)); expect((await book(api, other, doc.id, slot(3, 14))).status).toBe(201);
    const r = await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(3, 14) });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('SLOT_ALREADY_BOOKED');
    expect((await pool.query('SELECT status FROM appointments WHERE id=$1', [a.body.id])).rows[0].status).toBe('CONFIRMED');
    expect((await pool.query(`SELECT count(*)::int n FROM notifications WHERE type='APPT_RESCHEDULED'`)).rows[0].n).toBe(0);
  });

  it('rejects: same slot, someone else\'s appointment, non-confirmed, and a doctor on leave', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient(); const q = await createPatient();
    const a = await book(api, p, doc.id, slot(3, 10));
    expect((await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(3, 10) })).body.error.code).toBe('SAME_SLOT');
    expect((await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(q.token)).send({ startAt: slot(3, 11) })).status).toBe(404);
    expect((await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(doc.token)).send({ startAt: slot(3, 11) })).status).toBe(403);
    await api().post('/doctors/me/leaves').set(auth(doc.token)).send({ startsAt: slot(5, 0), endsAt: slot(5, 23), reason: 'conf' });
    const l = await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(5, 10) });
    expect(l.body.error.code).toBe('DOCTOR_ON_LEAVE');
    await api().delete(`/appointments/${a.body.id}`).set(auth(p.token));
    expect((await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(3, 11) })).body.error.code).toBe('NOT_RESCHEDULABLE');
  });

  it('concurrent reschedules of different patients into one slot: exactly one wins, loser keeps original', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const ps = await Promise.all([createPatient(), createPatient(), createPatient()]);
    const as = await Promise.all(ps.map((p, i) => book(api, p, doc.id, slot(3, 9 + i))));
    const rs = await Promise.all(ps.map((p, i) => api().post(`/appointments/${as[i].body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(3, 15) })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await pool.query(`SELECT count(*)::int n FROM appointments WHERE status='CONFIRMED'`)).rows[0].n).toBe(3);
  });

  it('does not deadlock with a doctor adding leave at the same moment', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const ps = await Promise.all([createPatient(), createPatient(), createPatient(), createPatient()]);
    const as = await Promise.all(ps.map((p, i) => book(api, p, doc.id, slot(4, 9 + i))));
    const results = await Promise.all([
      ...ps.map((p, i) => api().post(`/appointments/${as[i].body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(4, 13 + i) })),
      api().post('/doctors/me/leaves').set(auth(doc.token)).send({ startsAt: slot(4, 0), endsAt: slot(4, 23), reason: 'x', cancelConflicts: true }),
    ]);
    for (const r of results) expect([200, 201, 409]).toContain(r.status);        // never 500 (deadlock)
    expect((await pool.query(`SELECT count(*)::int n FROM appointments WHERE status='CONFIRMED' AND start_at < '2999-01-01'
      AND tstzrange(start_at,end_at) && tstzrange($1::timestamptz,$2::timestamptz)`, [slot(4, 0), slot(4, 23)])).rows[0].n).toBeLessThanOrEqual(4);
  });
});

describe('no-show, listing, medications', () => {
  const past = async (id: string) => pool.query(`UPDATE appointments SET start_at = now() - interval '2 hours', end_at = now() - interval '90 minutes' WHERE id=$1`, [id]);

  it('doctor can mark an ended appointment no-show; not before it ends; not for another doctor\'s patient', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const other = await createDoctor(); const p = await createPatient();
    const a = await book(api, p, doc.id, slot(2));
    expect((await api().post(`/appointments/${a.body.id}/no-show`).set(auth(doc.token))).body.error.code).toBe('NOT_ENDED');
    await past(a.body.id);
    expect((await api().post(`/appointments/${a.body.id}/no-show`).set(auth(other.token))).status).toBe(404);
    expect((await api().post(`/appointments/${a.body.id}/no-show`).set(auth(p.token))).status).toBe(403);
    const ok = await api().post(`/appointments/${a.body.id}/no-show`).set(auth(doc.token));
    expect(ok.status).toBe(200); expect(ok.body.status).toBe('NO_SHOW');
    expect((await api().post(`/appointments/${a.body.id}/no-show`).set(auth(doc.token))).body.error.code).toBe('NOT_MARKABLE');
  });

  it('GET /appointments supports scope, limit/offset and X-Total-Count', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await book(api, p, doc.id, slot(2 + i))).body.id);
    await past(ids[0]);
    const up = await api().get('/appointments?scope=upcoming').set(auth(p.token));
    expect(up.body).toHaveLength(3); expect(up.headers['x-total-count']).toBe('3');
    expect(up.body.map((x: any) => x.start_at)).toEqual([...up.body.map((x: any) => x.start_at)].sort());
    const page = await api().get('/appointments?scope=all&limit=2&offset=1').set(auth(p.token));
    expect(page.body).toHaveLength(2); expect(page.headers['x-total-count']).toBe('4');
    expect(page.body[0]).not.toHaveProperty('total');
    expect((await api().get('/appointments?scope=past').set(auth(p.token))).body.map((x: any) => x.id)).toEqual([ids[0]]);
    const na = await api().get('/appointments?scope=needs_action').set(auth(p.token));      // ended but unresolved: doctors must act on these
    expect(na.body.map((x: any) => x.id)).toEqual([ids[0]]);
    await api().post(`/appointments/${ids[0]}/no-show`).set(auth(doc.token));
    expect((await api().get('/appointments?scope=needs_action').set(auth(p.token))).body).toEqual([]);
    expect((await api().get('/appointments?limit=0').set(auth(p.token))).status).toBe(400);
  });

  it('GET /medications returns the patient\'s active prescriptions with times and next reminder', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient(); const q = await createPatient();
    const a = await book(api, p, doc.id, slot(2));
    await past(a.body.id);
    const done = await api().post(`/appointments/${a.body.id}/complete`).set(auth(doc.token)).send({
      notes: 'Viral fever, rest.', medications: [{ name: 'Paracetamol', dosage: '500mg', timesOfDay: ['08:00', '20:00'], durationDays: 3, instructions: 'after food' }] });
    expect(done.status).toBe(200);
    const m = await api().get('/medications').set(auth(p.token));
    expect(m.status).toBe(200); expect(m.body).toHaveLength(1);
    expect(m.body[0]).toMatchObject({ name: 'Paracetamol', dosage: '500mg', times_of_day: ['08:00', '20:00'], instructions: 'after food' });
    expect(new Date(m.body[0].next_reminder_at).getTime()).toBeGreaterThan(Date.now());
    expect((await api().get('/medications').set(auth(q.token))).body).toEqual([]);
    expect((await api().get('/medications').set(auth(doc.token))).status).toBe(403);
  });
});

describe('Google Calendar connect (OAuth, with a fake Google)', () => {
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

  it('connect -> callback stores an ENCRYPTED-at-rest token (when a key is set), syncs existing appointments, redirects to the client', async () => {
    const oauth = new FakeOAuth(); const { api, jobs } = makeApp(oauth);
    const doc = await createDoctor(); const p = await createPatient();
    const a = await book(api, p, doc.id, slot(3));
    const c = await api().get('/doctors/me/calendar/connect').set(auth(doc.token));
    expect(c.status).toBe(200);
    const cb = await api().get(`/calendar/callback?code=abc&state=${encodeURIComponent(stateOf(c.body.url))}`);
    expect(cb.status).toBe(302); expect(cb.headers.location).toBe(`${config.clientUrl}/doctor?calendar=connected`);
    expect(oauth.exchanged).toEqual(['abc']);
    const stored = (await pool.query('SELECT google_refresh_token t FROM doctors WHERE id=$1', [doc.id])).rows[0].t;
    expect(decryptSecret(stored)).toBe('rt-for-abc');
    expect(jobs.calendars).toContain(a.body.id);
    const me = await api().get('/me').set(auth(doc.token));
    expect(me.body).toMatchObject({ role: 'DOCTOR', calendarConnected: true });
    expect((await api().delete('/doctors/me/calendar').set(auth(doc.token))).status).toBe(204);
    expect((await api().get('/me').set(auth(doc.token))).body.calendarConnected).toBe(false);
  });

  it('rejects forged, expired, wrong-purpose or login tokens used as state; denied/failed exchanges redirect with a status', async () => {
    const oauth = new FakeOAuth(); const { api } = makeApp(oauth); const doc = await createDoctor();
    const secret = config.jwtSecret;
    const forged = jwt.sign({ purpose: 'gcal' }, 'wrong-secret', { subject: doc.id, expiresIn: '10m' });
    const expired = jwt.sign({ purpose: 'gcal' }, secret, { subject: doc.id, expiresIn: -10 });
    const login = doc.token;                                                         // a normal session token has no purpose
    for (const s of [forged, expired, login, 'garbage']) expect((await api().get(`/calendar/callback?code=x&state=${encodeURIComponent(s)}`)).status).toBe(400);
    expect(oauth.exchanged).toEqual([]);
    const good = jwt.sign({ purpose: 'gcal' }, secret, { subject: doc.id, expiresIn: '10m' });
    expect((await api().get(`/calendar/callback?error=access_denied&state=${good}`)).headers.location).toContain('calendar=denied');
    oauth.failExchange = true;
    expect((await api().get(`/calendar/callback?code=x&state=${good}`)).headers.location).toContain('calendar=failed');
    expect((await pool.query('SELECT google_refresh_token t FROM doctors WHERE id=$1', [doc.id])).rows[0].t).toBeNull();
  });

  it('only doctors can start the flow; 501 when Google is not configured', async () => {
    const off = new FakeOAuth(); off.enabled = false; const { api } = makeApp(off);
    const doc = await createDoctor(); const p = await createPatient();
    expect((await api().get('/doctors/me/calendar/connect').set(auth(doc.token))).status).toBe(501);
    expect((await api().get('/doctors/me/calendar/connect').set(auth(p.token))).status).toBe(403);
  });

  it('calendarSync decrypts an encrypted stored token before calling Google', async () => {
    const key = 'a'.repeat(64); const enc = encryptSecret('real-refresh', key);
    expect(enc.startsWith('enc:v1:')).toBe(true); expect(enc).not.toContain('real-refresh');
    const prev = (config as any).tokenEncKey; (config as any).tokenEncKey = key;
    try {
      const { api } = makeApp(); const doc = await createDoctor({ token: true }); const p = await createPatient();
      await pool.query('UPDATE doctors SET google_refresh_token=$2 WHERE id=$1', [doc.id, encryptSecret('real-refresh')]);
      const a = await book(api, p, doc.id, slot(3)); const seen: string[] = [];
      await syncCalendar(pool, a.body.id, { createEvent: async (e) => { seen.push(e.refreshToken); }, deleteEvent: async () => {} });
      expect(seen).toEqual(['real-refresh']);
    } finally { (config as any).tokenEncKey = prev; }
  });
});

describe('migrations', () => {
  it('concurrent migrate() calls on a fresh database do not collide (API and worker boot together)', async () => {
    const { createPool } = await import('../src/db'); const { migrate } = await import('../src/migrate');
    const admin = createPool('postgresql://ham:ham@localhost:5432/postgres', 2);
    await admin.query('DROP DATABASE IF EXISTS ham_migrate_race WITH (FORCE)'); await admin.query('CREATE DATABASE ham_migrate_race');
    const pools = [1, 2, 3, 4].map(() => createPool('postgresql://ham:ham@localhost:5432/ham_migrate_race', 3));
    for (const p of pools) p.on('error', () => {});
    try {
      await Promise.all(pools.map((p) => migrate(p)));
      const n = (await pools[0].query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n;
      expect(n).toBeGreaterThanOrEqual(2);
      await migrate(pools[0]);                                                        // idempotent
    } finally { await Promise.all(pools.map((p) => p.end())); await new Promise((r) => setTimeout(r, 100)); await admin.query('DROP DATABASE IF EXISTS ham_migrate_race WITH (FORCE)'); await admin.end(); }
  });
});

describe('time zones', () => {
  it('browser aliases are canonicalised so every later AT TIME ZONE works; unknown zones are rejected up front', async () => {
    const { api } = makeApp(); const doc = await createDoctor();
    const reg = await api().post('/auth/register').send({ email: 'calcutta@x.test', password: 'Password#1', name: 'Chrome User', timezone: 'Asia/Calcutta' });
    expect(reg.status).toBe(201);
    expect((await pool.query(`SELECT timezone FROM users WHERE email='calcutta@x.test'`)).rows[0].timezone).toBe('Asia/Kolkata');
    const bad = await api().post('/auth/register').send({ email: 'bad@x.test', password: 'Password#1', name: 'X', timezone: 'Mars/Olympus' });
    expect(bad.status).toBe(400);
    // the exact failure seen in the browser run: completing a visit for a patient who registered from Chrome in India
    const a = await api().post('/appointments').set(auth(reg.body.token)).send({ doctorId: doc.id, startAt: slot(2), reason: 'tz regression' });
    await pool.query(`UPDATE appointments SET start_at = now() - interval '2 hours', end_at = now() - interval '90 minutes' WHERE id=$1`, [a.body.id]);
    const done = await api().post(`/appointments/${a.body.id}/complete`).set(auth(doc.token)).send({
      notes: 'all fine', medications: [{ name: 'X', dosage: '1', timesOfDay: ['09:00'], durationDays: 2 }] });
    expect(done.status).toBe(200);
  });
});

describe('crypto and throttle', () => {
  it('AES-GCM round-trips, uses a fresh IV, detects tampering, and passes legacy plaintext through', () => {
    const k = 'b'.repeat(64);
    const a = encryptSecret('secret', k), b = encryptSecret('secret', k);
    expect(a).not.toBe(b); expect(decryptSecret(a, k)).toBe('secret');
    const raw = Buffer.from(a.slice(7), 'base64'); raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret('enc:v1:' + raw.toString('base64'), k)).toThrow();
    expect(() => decryptSecret(a, 'c'.repeat(64))).toThrow();
    expect(decryptSecret('legacy-plain', k)).toBe('legacy-plain');
    expect(() => encryptSecret('x', 'abcd')).toThrow(/64 hex/);
    expect(encryptSecret('x', undefined)).toBe('x');
  });

  it('throttle blocks after the limit, sweeps expired windows, and stops cleanly', async () => {
    const t = createThrottle(2, 40);
    t.hit('k'); t.hit('k'); expect(() => t.hit('k')).toThrow(/Too many/);
    t.hit('other'); expect(t.size).toBe(2);
    await new Promise((r) => setTimeout(r, 120));
    t.hit('k'); expect(t.size).toBeGreaterThanOrEqual(1);
    t.stop();
  });

  it('login throttle returns 429 with Retry-After and does not leak across emails; register is throttled per IP', async () => {
    const { api } = makeApp(); const p = await createPatient();
    for (let i = 0; i < 10; i++) expect((await api().post('/auth/login').send({ email: p.email, password: 'wrong-password' })).status).toBe(401);
    const blocked = await api().post('/auth/login').send({ email: p.email, password: 'wrong-password' });
    expect(blocked.status).toBe(429); expect(blocked.headers['retry-after']).toBeDefined();
    expect((await api().post('/auth/login').send({ email: 'someone@else.test', password: 'wrong-password' })).status).toBe(401);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await api().post('/auth/register').send({ email: `u${i}@x.test`, password: 'Password#1', name: 'U' })).status;
    expect(last).toBe(429);
  });
});

describe('audit log', () => {
  it('records logins, PHI reads, writes with actor / request id, and cannot be altered or deleted', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient(); const admin = await adminToken();
    const a = await book(api, p, doc.id, slot(3));
    await api().get(`/appointments/${a.body.id}/summaries`).set(auth(doc.token)).set('X-Request-Id', 'req-12345678');
    await api().post('/auth/login').send({ email: p.email, password: 'nope-nope-nope' });
    await api().post('/auth/login').send({ email: p.email, password: 'Password#1' });
    const log = await api().get('/admin/audit?limit=50').set(auth(admin));
    const actions = log.body.map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['appointment.book', 'summary.read', 'auth.login_failed', 'auth.login']));
    const read = log.body.find((r: any) => r.action === 'summary.read');
    expect(read).toMatchObject({ actor_id: doc.id, actor_role: 'DOCTOR', resource_id: a.body.id, request_id: 'req-12345678' });
    const failed = log.body.find((r: any) => r.action === 'auth.login_failed');
    expect(JSON.stringify(failed)).not.toContain('nope-nope-nope');                       // never logs the password
    expect((await api().get('/admin/audit').set(auth(p.token))).status).toBe(403);
    expect((await api().get(`/admin/audit?action=summary.read`).set(auth(admin))).body.every((r: any) => r.action === 'summary.read')).toBe(true);
    await expect(pool.query(`UPDATE audit_log SET action='x'`)).rejects.toThrow(/append-only|immutable/i);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only|immutable/i);
  });
});

describe('ops: CORS, request ids, readiness, stats, OpenAPI', () => {
  it('CORS allows only configured origins; every response carries X-Request-Id', async () => {
    const { api } = makeApp();
    const ok = await api().options('/doctors').set('Origin', config.corsOrigins[0]).set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(config.corsOrigins[0]);
    const bad = await api().get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    expect((await api().get('/health')).headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
    expect((await api().get('/health').set('X-Request-Id', 'bad id')).headers['x-request-id']).not.toBe('bad id');
  });

  it('/ready reports migrations; /admin/stats aggregates', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient(); const admin = await adminToken();
    expect((await api().get('/ready')).body.ready).toBe(true);
    await book(api, p, doc.id, slot(3));
    const s = await api().get('/admin/stats').set(auth(admin));
    expect(s.body.appointments.CONFIRMED).toBe(1); expect(s.body.users.PATIENT).toBe(1);
    expect((await api().get('/admin/stats').set(auth(p.token))).status).toBe(403);
  });

  it('every Express route is documented in openapi.yaml, and vice versa', async () => {
    const { app, api } = makeApp();
    const spec = YAML.parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
    const documented = new Set<string>();
    for (const [path, ops] of Object.entries<any>(spec.paths))
      for (const m of Object.keys(ops)) if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) documented.add(`${m.toUpperCase()} ${path}`);
    const actual = new Set<string>();
    for (const layer of (app as any)._router.stack) if (layer.route)
      for (const m of Object.keys(layer.route.methods)) actual.add(`${m.toUpperCase()} ${layer.route.path.replace(/:(\w+)/g, '{$1}')}`);
    expect([...actual].filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((r) => !actual.has(r))).toEqual([]);
    expect((await api().get('/openapi.json')).body.info.title).toMatch(/Healthcare/);
  });

  it('reschedule email names old and new time', async () => {
    const { api } = makeApp(); const doc = await createDoctor(); const p = await createPatient(); const mailer = new FakeMailer();
    const a = await book(api, p, doc.id, slot(3, 10));
    await api().post(`/appointments/${a.body.id}/reschedule`).set(auth(p.token)).send({ startAt: slot(3, 14) });
    const ids = (await pool.query(`SELECT id FROM notifications WHERE type='APPT_RESCHEDULED'`)).rows;
    for (const r of ids) await processNotification(pool, r.id, mailer);
    expect(mailer.sent).toHaveLength(2);
    for (const m of mailer.sent) { expect(m.subject).toMatch(/rescheduled/i); expect(m.text).toMatch(/moved from/); }
  });
});
