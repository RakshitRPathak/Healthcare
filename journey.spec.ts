import { expect, test, Browser, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const DB = 'postgresql://ham:ham@localhost:5432/ham_e2e';
const sql = (q: string) => execFileSync('psql', [DB, '-tAc', q], { encoding: 'utf8' }).trim();
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
const run = Date.now().toString(36);
const patientEmail = `priya.${run}@example.test`, doctorEmail = `meera.${run}@clinic.test`;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const newPage = async (b: Browser) => (await b.newContext()).newPage();
const pickDoctor = async (page: Page) => { await page.getByRole('button', { name: /Meera Nair/ }).click(); await expect(page.getByRole('list', { name: 'Available slots' })).toBeVisible(); };

test.describe.serial('clinic journey', () => {
  test('admin adds a doctor who works every day', async ({ browser }) => {
    const page = await newPage(browser);
    await login(page, 'admin@clinic.test', 'Admin#12345');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await page.getByRole('link', { name: 'Doctors' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Meera Nair');
    await page.getByLabel('Email').fill(doctorEmail); await page.getByLabel('Initial password').fill('Doctor#98765');
    await page.getByLabel('Specialty').fill('Internal Medicine');
    for (const d of ['Sun', 'Sat']) await page.getByText(d, { exact: true }).click();
    await shot(page, '01-admin-add-doctor');
    await page.getByRole('button', { name: 'Add doctor' }).click();
    await expect(page.getByText('Dr. Meera Nair added.')).toBeVisible();
    await expect(page.getByRole('list').getByText('Dr. Meera Nair')).toBeVisible();
  });

  test('patient registers, books, and reschedules', async ({ browser }) => {
    const page = await newPage(browser);
    await page.goto('/register');
    await shot(page, '02-register');
    await page.getByLabel('Full name').fill('Priya Sharma'); await page.getByLabel('Email').fill(patientEmail);
    await page.getByLabel('Password').fill('Patient#98765'); await page.getByLabel('Allergies (optional)').fill('penicillin');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Book a visit' })).toBeVisible();

    await pickDoctor(page);
    await shot(page, '03-slots');
    await page.getByRole('list', { name: 'Available slots' }).getByRole('button', { name: /10:00/ }).click();
    await expect(page.getByTestId('countdown')).toHaveText(/^[45]:\d\d$/);
    await page.getByLabel(/What is the visit about/).fill('Recurring headaches for two weeks');
    await shot(page, '04-hold-countdown');
    await page.getByRole('button', { name: 'Confirm appointment' }).click();

    await expect(page.getByRole('heading', { name: 'My appointments' })).toBeVisible();
    await expect(page.getByText('confirmed', { exact: true })).toBeVisible();
    await shot(page, '05-my-appointments');

    await page.getByRole('button', { name: 'Reschedule' }).click();
    const dlg = page.getByRole('dialog', { name: 'Reschedule' });
    await expect(dlg.getByRole('list', { name: 'Available slots' })).toBeVisible();
    await shot(page, '06-reschedule');
    await dlg.getByRole('list', { name: 'Available slots' }).getByRole('button', { name: /11:00/ }).click();
    await expect(page.getByText(/Appointment moved/)).toBeVisible();
    await expect(page.getByText(/11:00/).first()).toBeVisible();
    expect(sql(`select string_agg(status, ',' order by created_at) from appointments`)).toBe('CANCELLED,CONFIRMED');
  });

  test('a second patient with a stale grid loses the race gracefully', async ({ browser }) => {
    const a = await newPage(browser), b = await newPage(browser);
    for (const [p, n] of [[a, 'a'], [b, 'b']] as const) {
      await p.goto('/register');
      await p.getByLabel('Full name').fill(`Racer ${n}`); await p.getByLabel('Email').fill(`racer.${n}.${run}@example.test`); await p.getByLabel('Password').fill('Patient#98765');
      await p.getByRole('button', { name: 'Create account' }).click(); await pickDoctor(p);
    }
    const slot = (p: Page) => p.getByRole('list', { name: 'Available slots' }).getByRole('button', { name: '2:00 pm', exact: true });
    await slot(a).click();                                       // A holds 2pm; B's grid is now stale
    await a.getByLabel(/What is the visit about/).fill('Routine check'); await a.getByRole('button', { name: 'Confirm appointment' }).click();
    await expect(a.getByRole('heading', { name: 'My appointments' })).toBeVisible();
    await slot(b).click();
    await expect(b.getByText(/Someone just took that slot/)).toBeVisible();
    await expect(slot(b)).toHaveCount(0);                        // grid refreshed: the slot is gone
    await shot(b, '07-lost-race');
    expect(sql(`select count(*) from appointments where status='CONFIRMED' and start_at = (select start_at from appointments where reason='Routine check')`)).toBe('1');
  });

  test('doctor sees the brief, completes the visit, approves the summary; patient reads it and sees medications', async ({ browser }) => {
    const doc = await newPage(browser);
    await login(doc, doctorEmail, 'Doctor#98765');
    await expect(doc.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    const row = doc.getByRole('listitem').filter({ hasText: 'Priya Sharma' });
    await expect(row).toContainText('Recurring headaches');
    await shot(doc, '08-doctor-schedule');
    await row.getByRole('button', { name: 'Pre-visit brief' }).click();
    const brief = doc.getByRole('dialog', { name: /Pre-visit brief/ });
    await expect(brief.getByText('penicillin')).toBeVisible({ timeout: 30_000 });      // worker generated it (template fallback, no LLM key)
    await expect(brief.getByText(/auto summary|AI-drafted/)).toBeVisible();
    await shot(doc, '09-pre-visit-brief');
    await brief.getByRole('button', { name: 'Close' }).click();

    sql(`update appointments set start_at = now() - interval '2 hours', end_at = now() - interval '90 minutes' where reason='Recurring headaches for two weeks' and status='CONFIRMED'`);
    await doc.reload();
    await expect(doc.getByText(/1 finished visit is waiting/)).toBeVisible();
    await shot(doc, '08b-needs-attention');
    await doc.getByRole('tab', { name: /Needs attention/ }).click();
    await doc.getByRole('listitem').filter({ hasText: 'Priya Sharma' }).getByRole('button', { name: 'Complete visit' }).click();
    await doc.getByLabel('Clinical notes').fill('Tension-type headache. Advised hydration, regular sleep. Paracetamol as needed.');
    await doc.getByRole('button', { name: '+ Add medication' }).click();
    await doc.getByLabel('Medication 1 name').fill('Paracetamol'); await doc.getByLabel('Medication 1 dosage').fill('500mg');
    await doc.getByLabel('Medication 1 days').fill('3'); await doc.getByLabel('Medication 1 instructions').fill('after food');
    await shot(doc, '10-complete-visit');
    await doc.getByRole('button', { name: 'Complete visit' }).last().click();
    await expect(doc.getByText(/Visit completed/)).toBeVisible();

    await doc.getByRole('tab', { name: 'History' }).click();
    await doc.getByRole('button', { name: 'Patient summary' }).click();
    const review = doc.getByRole('dialog', { name: /Review summary/ });
    await expect(review.getByText('awaiting your approval')).toBeVisible({ timeout: 30_000 });
    await shot(doc, '11-review-summary');

    const pat = await newPage(browser);
    await login(pat, patientEmail, 'Patient#98765');
    await pat.getByRole('link', { name: 'My appointments' }).click(); await pat.getByRole('tab', { name: 'past' }).click();
    await pat.getByRole('button', { name: 'View summary' }).click();
    await expect(pat.getByText(/being reviewed by your doctor/)).toBeVisible();            // NOT visible before approval
    await pat.getByRole('button', { name: 'Close' }).click();

    await review.getByRole('button', { name: 'Approve & send' }).click();
    await expect(doc.getByText(/Approved. The patient has been notified/)).toBeVisible();

    await pat.getByRole('button', { name: 'View summary' }).click();
    const sum = pat.getByRole('dialog', { name: /Visit summary/ });
    await expect(sum.getByText('Reviewed by your doctor')).toBeVisible();
    await expect(sum.getByText('Paracetamol').first()).toBeVisible();
    await shot(pat, '12-patient-summary');
    await sum.getByRole('button', { name: 'Close' }).click();

    await pat.getByRole('link', { name: 'Medications' }).click();
    const med = pat.getByRole('listitem').filter({ hasText: 'Paracetamol' });
    await expect(med).toContainText('500mg'); await expect(med).toContainText('next reminder');
    await shot(pat, '13-medications');
  });

  test('doctor leave: conflict is explained, nothing is cancelled silently', async ({ browser }) => {
    const doc = await newPage(browser); await login(doc, doctorEmail, 'Doctor#98765');
    await doc.getByRole('link', { name: 'Leave' }).click();
    const tomorrow = new Date(Date.now() + 86_400_000 * 1).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await doc.getByLabel('From').fill(tomorrow); await doc.getByLabel('Start time').fill('09:00'); await doc.getByLabel('End time').fill('17:00');
    await doc.getByRole('button', { name: 'Add leave' }).click();
    const dlg = doc.getByRole('dialog', { name: /overlaps booked visits/ });
    await expect(dlg).toBeVisible(); await shot(doc, '14-leave-conflict');
    expect(sql(`select count(*) from appointments where status='CONFIRMED'`)).toBe('1');          // still confirmed (Priya's visit was completed above)
    await dlg.getByRole('button', { name: /Cancel 1 and notify patients/ }).click();
    await expect(doc.getByText(/Affected patients were notified/)).toBeVisible();
    expect(sql(`select count(*) from appointments where status='CANCELLED_LEAVE'`)).toBe('1');
  });

  test('admin sees stats, the audit trail (immutable), and delivered emails', async ({ browser }) => {
    const admin = await newPage(browser); await login(admin, 'admin@clinic.test', 'Admin#12345');
    await expect(admin.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(admin.getByText('Notification delivery')).toBeVisible();
    await shot(admin, '15-admin-overview');
    await admin.getByRole('link', { name: 'Audit log' }).click();
    await expect(admin.getByRole('cell', { name: 'summary.approve' })).toBeVisible();
    await expect(admin.getByRole('cell', { name: 'leave.create' })).toBeVisible();
    await shot(admin, '16-audit');
    await expect.poll(() => sql(`select count(*) from notifications where status='SENT'`), { timeout: 30_000 }).not.toBe('0');
    expect(() => sql(`delete from audit_log`)).toThrow();
    expect(sql(`select count(*) from notifications where status='DEAD'`)).toBe('0');
  });
});
