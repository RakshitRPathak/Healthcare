const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://ham:ham@localhost:5432/ham',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  bcryptCost: Number(process.env.BCRYPT_COST ?? 10),
  port: Number(process.env.PORT ?? 3000),
  holdMinutes: Number(process.env.HOLD_MINUTES ?? 5),
  reminderHoursBefore: 24,
  maxNotificationAttempts: 5,
  medReminderMaxDays: 60,
  openaiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  smtp: { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
          user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
          from: process.env.MAIL_FROM ?? 'Clinic <no-reply@clinic.local>' },
  google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/calendar/callback' },
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY ?? '',                       // e.g. "1" behind one reverse proxy; needed for per-IP throttling
  logRequests: process.env.LOG_REQUESTS ? process.env.LOG_REQUESTS === 'true' : !process.env.VITEST,
  tokenEncKey: process.env.TOKEN_ENC_KEY,                          // 64 hex chars (32 bytes); encrypts Google refresh tokens at rest
};
if (prod && !process.env.TOKEN_ENC_KEY && process.env.GOOGLE_CLIENT_ID)
  console.warn('[config] TOKEN_ENC_KEY is not set: Google refresh tokens will be stored unencrypted');
