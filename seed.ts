import bcrypt from 'bcryptjs';
import { createPool } from './db';
import { migrate } from './migrate';

/** Demo data, idempotent. Passwords are for local demos only. */
const pool = createPool();
await migrate(pool);
const h = (p: string) => bcrypt.hashSync(p, 10);
let created = 0;
async function user(email: string, pw: string, role: string, name: string) {
  const r = await pool.query(`INSERT INTO users (email,password_hash,role,name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, [email, h(pw), role, name]);
  if (r.rows[0]) created++;
  return r.rows[0]?.id as string | undefined;
}
await user('admin@clinic.test', 'Admin#12345', 'ADMIN', 'Admin');
const doctors = [
  ['dr.rao@clinic.test', 'Asha Rao', 'General Medicine', 30, [1, 2, 3, 4, 5], '09:00', '17:00'],
  ['dr.iyer@clinic.test', 'Vikram Iyer', 'Cardiology', 20, [1, 3, 5], '10:00', '16:00'],
  ['dr.khan@clinic.test', 'Sana Khan', 'Dermatology', 15, [2, 4, 6], '11:00', '18:00'],
] as const;
for (const [email, name, spec, slot, days, from, to] of doctors) {
  const id = await user(email, 'Doctor#12345', 'DOCTOR', name);
  if (!id) continue;
  await pool.query(`INSERT INTO doctors (id, specialty, slot_minutes) VALUES ($1,$2,$3)`, [id, spec, slot]);
  for (const d of days) await pool.query(`INSERT INTO doctor_working_hours (doctor_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)`, [id, d, from, to]);
}
const pid = await user('patient@clinic.test', 'Patient#12345', 'PATIENT', 'Priya Sharma');
if (pid) await pool.query(`INSERT INTO patients (id, dob, allergies, chronic_conditions) VALUES ($1,'1992-03-14','penicillin','asthma')`, [pid]);
console.log(created ? `seeded ${created} users. admin@clinic.test / Admin#12345 · dr.rao@clinic.test / Doctor#12345 · patient@clinic.test / Patient#12345` : 'already seeded');
await pool.end();
