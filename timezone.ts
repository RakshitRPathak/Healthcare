import type { Db } from './db';
import { AppError } from './errors';

/** Old names that browsers (Chrome reports "Asia/Calcutta") and JS runtimes still emit, mapped to the current IANA name. */
const ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Rangoon': 'Asia/Yangon', 'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Dacca': 'Asia/Dhaka', 'Asia/Thimbu': 'Asia/Thimphu', 'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Atlantic/Faeroe': 'Atlantic/Faroe', 'Pacific/Truk': 'Pacific/Chuuk',
  'Etc/Unknown': 'UTC', 'Etc/UTC': 'UTC', 'GMT': 'UTC',
};

/**
 * Resolve a client-supplied zone to a name PostgreSQL itself accepts. A zone that JavaScript's Intl knows but Postgres does not
 * (this happened with "Asia/Calcutta") would otherwise be stored happily and then make `AT TIME ZONE` throw a 500 much later,
 * e.g. when a doctor completes a visit.
 */
export async function canonicalTimeZone(db: Db, name: string): Promise<string> {
  for (const candidate of [name, ALIASES[name]].filter(Boolean) as string[]) {
    const r = await db.query('SELECT name FROM pg_timezone_names WHERE lower(name)=lower($1) LIMIT 1', [candidate]);
    if (r.rows[0]) return r.rows[0].name as string;
  }
  throw new AppError(400, 'VALIDATION_ERROR', `Unknown time zone "${name}"`, [{ path: ['timezone'], message: 'unknown time zone' }]);
}
