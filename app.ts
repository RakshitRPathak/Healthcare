import express, { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import YAML from 'yaml';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { z, ZodError } from 'zod';
import { authenticate, requireRole, signToken, wrap } from './auth';
import { config } from './config';
import { AppError } from './errors';
import { Pool, tx } from './db';
import type { Jobs } from './jobs/types';
import { availableSlots } from './services/availability';
import * as booking from './services/booking';
import * as leaves from './services/leaves';
import { approvePost, listSummaries, postSchema } from './services/summaries';
import { audit, listAudit } from './services/audit';
import { createThrottle } from './throttle';
import { encryptSecret } from './crypto';
import { canonicalTimeZone } from './timezone';
import { GoogleOAuth, type CalendarOAuth } from './integrations/oauth';

export interface AppDeps { pool: Pool; jobs: Jobs; jwtSecret?: string; bcryptCost?: number; oauth?: CalendarOAuth }

const OPENAPI_PATH = new URL('../openapi.yaml', import.meta.url);

const tz = z.string().refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'invalid time zone');
const uuid = z.string().uuid();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export function createApp({ pool, jobs, jwtSecret = config.jwtSecret, bcryptCost = config.bcryptCost, oauth = new GoogleOAuth() }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.use((req, res, next) => {                                   // request id (honour a sane inbound one) + structured access log
    const inbound = req.header('x-request-id');
    req.id = inbound && /^[\w.-]{8,64}$/.test(inbound) ? inbound : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    if (config.logRequests) {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => console.log(JSON.stringify({ t: new Date().toISOString(), id: req.id, method: req.method, path: req.path,
        status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10, user: req.user?.id })));
    }
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['X-Total-Count', 'X-Request-Id'], maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));
  const auth = authenticate(jwtSecret);
  const dummyHash = bcrypt.hashSync('not-a-real-password', bcryptCost);   // equalises login timing for unknown emails

  const loginThrottle = createThrottle(10, 15 * 60_000, 'TOO_MANY_ATTEMPTS', 'Too many login attempts, try again later');
  const registerThrottle = createThrottle(30, 60 * 60_000, 'TOO_MANY_ATTEMPTS', 'Too many sign-ups from this address, try again later');

  app.get('/health', wrap(async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));
  app.get('/ready', wrap(async (_req, res) => {
    const r = await pool.query(`SELECT count(*)::int AS n FROM schema_migrations`).catch(() => ({ rows: [{ n: 0 }] }));
    if (!r.rows[0].n) throw new AppError(503, 'NOT_READY', 'Database not migrated');
    res.json({ ready: true, migrations: r.rows[0].n });
  }));
  let spec: any;
  app.get('/openapi.json', (_req, res) => { spec ??= YAML.parse(readFileSync(OPENAPI_PATH, 'utf8')); res.json(spec); });

  // ---------- auth
  const registerSchema = z.object({
    email: z.string().email().max(254), password: z.string().min(8).max(128), name: z.string().trim().min(1).max(100),
    timezone: tz.optional(), dob: z.string().date().optional(),
    allergies: z.string().max(500).optional(), chronicConditions: z.string().max(500).optional(),
  });
  app.post('/auth/register', wrap(async (req, res) => {
    registerThrottle.hit(req.ip ?? 'unknown');
    const b = registerSchema.parse(req.body);
    const zone = b.timezone ? await canonicalTimeZone(pool, b.timezone) : null;
    const hash = await bcrypt.hash(b.password, bcryptCost);
    const id = await tx(pool, async (c) => {
      try {
        const u = (await c.query(`INSERT INTO users (email,password_hash,role,name,timezone) VALUES ($1,$2,'PATIENT',$3,COALESCE($4,'Asia/Kolkata')) RETURNING id`,
          [b.email, hash, b.name, zone])).rows[0];
        await c.query('INSERT INTO patients (id, dob, allergies, chronic_conditions) VALUES ($1,$2,$3,$4)', [u.id, b.dob ?? null, b.allergies ?? null, b.chronicConditions ?? null]);
        return u.id as string;
      } catch (e: any) { if (e.code === '23505') throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered'); throw e; }
    });
    res.status(201).json({ id, token: signToken({ id, role: 'PATIENT' }, jwtSecret) });
  }));

  app.post('/auth/login', wrap(async (req, res) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    loginThrottle.hit(`${req.ip}|${b.email.toLowerCase()}`);
    const u = (await pool.query('SELECT id, role, password_hash FROM users WHERE lower(email)=lower($1)', [b.email])).rows[0];
    const ok = await bcrypt.compare(b.password, u?.password_hash ?? dummyHash);
    if (!u || !ok) {
      await audit(pool, req, { action: 'auth.login_failed', meta: { email: b.email.toLowerCase() } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    await audit(pool, { ...req, user: { id: u.id, role: u.role }, ip: req.ip, id: req.id }, { action: 'auth.login' });
    res.json({ token: signToken({ id: u.id, role: u.role }, jwtSecret), role: u.role });
  }));

  app.get('/me', auth, wrap(async (req, res) => {
    const u = (await pool.query(
      `SELECT u.id, u.email, u.role, u.name, u.timezone, d.specialty, d.slot_minutes, (d.google_refresh_token IS NOT NULL) AS calendar_connected
       FROM users u LEFT JOIN doctors d ON d.id=u.id WHERE u.id=$1`, [req.user!.id])).rows[0];
    if (!u) throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists');
    res.json({ id: u.id, email: u.email, role: u.role, name: u.name, timezone: u.timezone,
               ...(u.role === 'DOCTOR' ? { specialty: u.specialty, slotMinutes: u.slot_minutes, calendarConnected: u.calendar_connected, calendarAvailable: oauth.enabled } : {}) });
  }));

  // ---------- admin
  app.post('/admin/doctors', auth, requireRole('ADMIN'), wrap(async (req, res) => {
    const b = z.object({
      email: z.string().email(), password: z.string().min(8), name: z.string().min(1), specialty: z.string().min(1),
      slotMinutes: z.number().int().min(5).max(240).default(30), timezone: tz.default('Asia/Kolkata'),
      workingHours: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm })).min(1),
    }).refine((v) => v.workingHours.every((w) => w.end > w.start), 'end must be after start').parse(req.body);
    b.timezone = await canonicalTimeZone(pool, b.timezone);
    const hash = await bcrypt.hash(b.password, bcryptCost);
    const id = await tx(pool, async (c) => {
      try {
        const u = (await c.query(`INSERT INTO users (email,password_hash,role,name,timezone) VALUES ($1,$2,'DOCTOR',$3,$4) RETURNING id`, [b.email, hash, b.name, b.timezone])).rows[0];
        await c.query('INSERT INTO doctors (id, specialty, slot_minutes, timezone) VALUES ($1,$2,$3,$4)', [u.id, b.specialty, b.slotMinutes, b.timezone]);
        for (const w of b.workingHours) await c.query('INSERT INTO doctor_working_hours (doctor_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [u.id, w.weekday, w.start, w.end]);
        return u.id as string;
      } catch (e: any) { if (e.code === '23505') throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered'); throw e; }
    });
    await audit(pool, req, { action: 'doctor.create', resourceType: 'user', resourceId: id });
    res.status(201).json({ id });
  }));
  app.get('/admin/audit', auth, requireRole('ADMIN'), wrap(async (req, res) => {
    const q = z.object({ actorId: uuid.optional(), action: z.string().max(80).optional(), resourceId: z.string().max(80).optional(),
                         limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    res.json(await listAudit(pool, q));
  }));
  app.get('/admin/stats', auth, requireRole('ADMIN'), wrap(async (_req, res) => {
    const [ap, nt, us, sm] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS n FROM appointments GROUP BY status`),
      pool.query(`SELECT status, count(*)::int AS n FROM notifications GROUP BY status`),
      pool.query(`SELECT role, count(*)::int AS n FROM users GROUP BY role`),
      pool.query(`SELECT kind, source, count(*)::int AS n FROM visit_summaries WHERE content IS NOT NULL GROUP BY kind, source`)]);
    const tally = (rows: any[], k: string) => Object.fromEntries(rows.map((r) => [r[k], r.n]));
    res.json({ appointments: tally(ap.rows, 'status'), notifications: tally(nt.rows, 'status'), users: tally(us.rows, 'role'),
               summaries: sm.rows.map((r) => ({ kind: r.kind, source: r.source, count: r.n })) });
  }));
  app.get('/admin/notifications', auth, requireRole('ADMIN'), wrap(async (req, res) => {
    const status = z.enum(['PENDING','QUEUED','SENDING','SENT','FAILED','DEAD','CANCELLED']).default('DEAD').parse(req.query.status);
    res.json((await pool.query('SELECT id,user_id,type,status,attempts,last_error,send_at FROM notifications WHERE status=$1 ORDER BY updated_at DESC LIMIT 200', [status])).rows);
  }));
  app.post('/admin/notifications/:id/retry', auth, requireRole('ADMIN'), wrap(async (req, res) => {
    const r = await pool.query(`UPDATE notifications SET status='PENDING', attempts=0, send_at=now(), updated_at=now() WHERE id=$1 AND status IN ('DEAD','FAILED') RETURNING id`, [uuid.parse(req.params.id)]);
    if (!r.rowCount) throw new AppError(404, 'NOT_FOUND', 'No retryable notification with that id');
    await audit(pool, req, { action: 'notification.retry', resourceType: 'notification', resourceId: req.params.id });
    res.json({ requeued: true });
  }));

  // ---------- doctors, slots, leave
  app.get('/doctors', auth, wrap(async (_req, res) => {
    res.json((await pool.query(`SELECT d.id, u.name, d.specialty, d.timezone, d.slot_minutes FROM doctors d JOIN users u ON u.id=d.id ORDER BY u.name`)).rows);
  }));
  app.get('/doctors/:id/slots', auth, wrap(async (req, res) => {
    const date = z.string().date().parse(req.query.date);
    const slots = await availableSlots(pool, uuid.parse(req.params.id), date);
    res.json(slots.map((s) => ({ startAt: s.start_at, endAt: s.end_at })));
  }));
  app.post('/doctors/me/leaves', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    const out = await leaves.createLeave(pool, jobs, req.user!.id, leaves.leaveSchema.parse(req.body));
    await audit(pool, req, { action: 'leave.create', resourceType: 'leave', resourceId: (out as any).id, meta: { cancelConflicts: Boolean(req.body?.cancelConflicts) } });
    res.status(201).json(out);
  }));
  app.get('/doctors/me/leaves', auth, requireRole('DOCTOR'), wrap(async (req, res) => { res.json(await leaves.listLeaves(pool, req.user!.id)); }));
  app.delete('/doctors/me/leaves/:id', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    await leaves.deleteLeave(pool, req.user!.id, uuid.parse(req.params.id));
    await audit(pool, req, { action: 'leave.delete', resourceType: 'leave', resourceId: req.params.id });
    res.status(204).end();
  }));

  // ---------- Google Calendar connect (doctor). `state` is a signed, short-lived JWT so the callback needs no session.
  app.get('/doctors/me/calendar/connect', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    if (!oauth.enabled) throw new AppError(501, 'CALENDAR_NOT_CONFIGURED', 'Google Calendar is not configured on this server');
    const state = jwt.sign({ purpose: 'gcal' }, jwtSecret, { subject: req.user!.id, expiresIn: '10m', algorithm: 'HS256' });
    res.json({ url: oauth.authUrl(state) });
  }));
  app.get('/calendar/callback', wrap(async (req, res) => {
    const back = (status: string) => res.redirect(`${config.clientUrl}/doctor?calendar=${status}`);
    const { code, state, error } = z.object({ code: z.string().max(2048).optional(), state: z.string().max(2048), error: z.string().optional() }).parse(req.query);
    let doctorId: string;
    try {
      const p = jwt.verify(state, jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (p.purpose !== 'gcal' || !p.sub) throw new Error('wrong purpose');
      doctorId = p.sub;
    } catch { throw new AppError(400, 'BAD_STATE', 'Invalid or expired connect request'); }
    if (error || !code) return back('denied');
    try {
      const { refreshToken } = await oauth.exchange(code);
      await pool.query('UPDATE doctors SET google_refresh_token=$2 WHERE id=$1', [doctorId, encryptSecret(refreshToken)]);
      await audit(pool, { user: { id: doctorId, role: 'DOCTOR' }, ip: req.ip, id: req.id }, { action: 'calendar.connect' });
      // existing future appointments get synced now that a calendar exists
      const up = await pool.query(`SELECT id FROM appointments WHERE doctor_id=$1 AND status='CONFIRMED' AND start_at>now() AND google_event_id IS NULL`, [doctorId]);
      await Promise.allSettled(up.rows.map((r) => jobs.calendar(r.id)));
      back('connected');
    } catch (e) { console.error('[calendar] connect failed', (e as Error).message); back('failed'); }
  }));
  app.delete('/doctors/me/calendar', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    await pool.query('UPDATE doctors SET google_refresh_token=NULL WHERE id=$1', [req.user!.id]);
    await audit(pool, req, { action: 'calendar.disconnect' });
    res.status(204).end();
  }));

  // ---------- appointments
  app.post('/appointments', auth, requireRole('PATIENT'), wrap(async (req, res) => {
    const a = await booking.book(pool, jobs, req.user!.id, booking.bookSchema.parse(req.body));
    await audit(pool, req, { action: 'appointment.book', resourceType: 'appointment', resourceId: (a as any).id });
    res.status(201).json(a);
  }));
  app.post('/appointments/hold', auth, requireRole('PATIENT'), wrap(async (req, res) => {
    res.status(201).json(await booking.hold(pool, req.user!.id, booking.holdSchema.parse(req.body)));
  }));
  app.post('/appointments/:id/confirm', auth, requireRole('PATIENT'), wrap(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    const a = await booking.confirmHold(pool, jobs, req.user!.id, uuid.parse(req.params.id), reason);
    await audit(pool, req, { action: 'appointment.confirm', resourceType: 'appointment', resourceId: req.params.id });
    res.json(a);
  }));
  app.get('/appointments', auth, wrap(async (req, res) => {
    const rows = await booking.listFor(pool, req.user!, booking.listSchema.parse(req.query));
    res.setHeader('X-Total-Count', String(rows[0]?.total ?? 0));
    res.json(rows.map(({ total, ...r }: any) => r));
  }));
  app.post('/appointments/:id/reschedule', auth, requireRole('PATIENT'), wrap(async (req, res) => {
    const out = await booking.reschedule(pool, jobs, req.user!.id, uuid.parse(req.params.id), booking.rescheduleSchema.parse(req.body));
    await audit(pool, req, { action: 'appointment.reschedule', resourceType: 'appointment', resourceId: req.params.id, meta: { newId: (out as any).id } });
    res.json(out);
  }));
  app.post('/appointments/:id/no-show', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    const out = await booking.markNoShow(pool, req.user!.id, uuid.parse(req.params.id));
    await audit(pool, req, { action: 'appointment.no_show', resourceType: 'appointment', resourceId: req.params.id });
    res.json(out);
  }));
  app.get('/medications', auth, requireRole('PATIENT'), wrap(async (req, res) => { res.json(await booking.listMedications(pool, req.user!.id)); }));
  app.delete('/appointments/:id', auth, wrap(async (req, res) => {
    const reason = typeof req.query.reason === 'string' ? req.query.reason.slice(0, 300) : undefined;
    const out = await booking.cancel(pool, jobs, req.user!, uuid.parse(req.params.id), reason);
    await audit(pool, req, { action: 'appointment.cancel', resourceType: 'appointment', resourceId: req.params.id });
    res.json(out);
  }));
  app.post('/appointments/:id/complete', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    await booking.complete(pool, jobs, req.user!.id, uuid.parse(req.params.id), booking.completeSchema.parse(req.body));
    await audit(pool, req, { action: 'appointment.complete', resourceType: 'appointment', resourceId: req.params.id });
    res.json({ completed: true });
  }));
  app.get('/appointments/:id/summaries', auth, wrap(async (req, res) => {
    const out = await listSummaries(pool, req.user!, uuid.parse(req.params.id));
    await audit(pool, req, { action: 'summary.read', resourceType: 'appointment', resourceId: req.params.id, meta: { count: (out as any[]).length } });   // PHI read
    res.json(out);
  }));
  app.post('/summaries/:id/approve', auth, requireRole('DOCTOR'), wrap(async (req, res) => {
    const edited = req.body?.content ? postSchema.parse(req.body.content) : undefined;
    const out = await approvePost(pool, req.user!.id, uuid.parse(req.params.id), edited);
    await audit(pool, req, { action: 'summary.approve', resourceType: 'summary', resourceId: req.params.id, meta: { edited: Boolean(edited) } });
    res.json(out);
  }));

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError && err.status === 429) res.setHeader('Retry-After', '60');
    if (err instanceof AppError) return void res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return void res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues } });
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON' } });
    console.error(JSON.stringify({ level: 'error', id: _req.id, path: _req.path, msg: err?.message, stack: err?.stack }));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  };
  app.use(onError);
  return app;
}
