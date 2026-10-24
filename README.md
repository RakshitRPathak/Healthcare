# Healthcare Appointment & Follow-up Manager

Book, hold, reschedule and cancel appointments without double-booking. Doctors get a pre-visit brief, complete visits with prescriptions, and approve a plain-language summary before the patient sees it. Medication reminders and every email go through a reliable outbox.

The server (Node, TypeScript, Express, PostgreSQL, BullMQ) was already built and well tested. This version adds a **web client** (patient, doctor and admin portals), a **Google Calendar connect flow**, **reschedule / no-show / medications**, an **audit log**, and production hardening, plus Docker and CI.

| Patient books | Hold & confirm | Doctor pre-visit brief |
|---|---|---|
| ![slots](docs/screenshots/03-slots.png) | ![hold](docs/screenshots/04-hold-countdown.png) | ![brief](docs/screenshots/09-pre-visit-brief.png) |
| **Review before the patient sees it** | **Leave conflicts are never silent** | **Audit log** |
| ![review](docs/screenshots/11-review-summary.png) | ![leave](docs/screenshots/14-leave-conflict.png) | ![audit](docs/screenshots/16-audit.png) |

*(The UI is branded "CareLoop" in one constant, `BRAND` in `client/src/ui.tsx`. Change it freely.)*

## Run it

**Docker** (needs Docker with Compose)
```bash
cp .env.example .env              # set JWT_SECRET at least
docker compose up --build         # app on http://localhost:8080
docker compose exec server npx tsx src/seed.ts
```
**Local**
```bash
# needs Postgres 16 and Redis running locally
cd server && npm ci && export DATABASE_URL=postgresql://ham:ham@localhost:5432/ham
npm run seed && npm start         # API on :3000
npm run worker                    # emails, summaries, calendar sync, sweeps (separate process)
cd ../client && npm ci && npm run dev    # http://localhost:5173
```
Demo logins after `seed`: `admin@clinic.test / Admin#12345`, `dr.rao@clinic.test / Doctor#12345`, `patient@clinic.test / Patient#12345`.

Everything optional degrades gracefully: no `OPENAI_API_KEY` → summaries use a deterministic template (and say so in the UI); no SMTP → emails are logged; no Google keys → the calendar card is hidden. See `.env.example`.

## What's in the box

- **Concurrency-safe booking.** One transaction locks the doctor row, validates the slot against working hours (in the doctor's time zone), checks leave, expires stale holds, then inserts. Two Postgres `EXCLUDE USING gist` constraints (doctor and patient) make double-booking impossible even if application code is wrong. 5-minute holds; confirming late returns `410 HOLD_EXPIRED`.
- **Reschedule** (same doctor, one transaction): the patient ends up with the new slot or keeps the old one, never neither. Locks doctor-then-appointment, the same order leave creation uses, so the two cannot deadlock (tested).
- **Doctor leave.** Booking into leave → `409 DOCTOR_ON_LEAVE`. Adding leave over bookings → `409 LEAVE_CONFLICTS` with the list and **no changes**; only with `cancelConflicts` are they cancelled and patients emailed.
- **Reliable email.** Transactional outbox, `FOR UPDATE SKIP LOCKED` dispatcher, atomic claim, retries with backoff, `DEAD` dead-letter queue with admin retry, and a reconcile sweep. At-least-once with a stable `Message-ID`. Emails carry no clinical content.
- **LLM summaries.** Versioned, grounded prompts with a prompt-injection guard; output validated with zod; post-visit output is checked so the model can't invent a drug. On any failure a stored deterministic fallback is used and later upgraded on success. The patient sees the summary only after the doctor approves (and can edit) it.
- **Google Calendar.** Doctors connect with OAuth (the `state` is a signed 10-minute token); sync is idempotent. Refresh tokens are **AES-256-GCM encrypted at rest** when `TOKEN_ENC_KEY` is set.
- **Audit log.** Logins (and failures), PHI reads, and every write are recorded with actor, request id and IP. A database trigger makes the table append-only, even for the application's own DB user.
- **Hardening.** CORS allowlist, request ids and JSON access logs, bounded login and sign-up throttles (the old in-memory one never evicted), `TRUST_PROXY` support, `/health` and `/ready`, graceful shutdown, safe concurrent migrations (advisory lock), time-zone canonicalisation (see below).
- **OpenAPI** at `/openapi.json`; a test fails if a route is added without documenting it.

More detail, with diagrams, in [ARCHITECTURE.md](ARCHITECTURE.md).

## Tests

| Suite | Count | What it covers |
|---|---|---|
| `server` (vitest + supertest, **real Postgres**) | 73 | double-booking races, holds, leave, outbox & retries, LLM failure modes, calendar sync, security, reschedule (incl. deadlock check), OAuth with a fake Google, crypto, audit immutability, throttles, OpenAPI coverage, concurrent migrations |
| `client` component tests (vitest + Testing Library) | 13 | login/guards, hold countdown and expiry, losing a slot race, leave-conflict dialog, time helpers |
| `client` end-to-end (Playwright, real server + worker + Postgres + Redis) | 6 | admin adds a doctor → patient registers, books, reschedules → two patients race for one slot → doctor completes a visit and approves the summary → patient reads it → leave conflict → admin audit |

```bash
cd server && npm test           # needs Postgres with a ham_test database
cd client && npm test           # component tests
cd client && npx playwright install chromium && npm run e2e
```
CI (`.github/workflows/ci.yml`) runs all three with Postgres and Redis services.

### Bugs found while testing
Three were in the original server; the second was in my new client and was caught by the browser run.
- **`Asia/Calcutta` crashed visit completion (original).** The old time-zone check used JavaScript's `Intl`, which accepts names Postgres rejects. Chrome in India reports exactly that name, so a patient could register and book, and then the doctor's "complete visit" returned a 500. Zones are now resolved against Postgres at sign-up (aliases mapped, unknowns rejected) — regression-tested.
- **Finished visits vanished from the doctor's list (new client)** once they were no longer "upcoming", hiding the Complete and No-show buttons. Added a `needs_action` scope and a "Needs attention" tab.
- **Login throttle leaked memory (original)** (entries never removed). Replaced with a swept, bounded version.
- **API and worker starting together could race on migrations (original).** Now serialised with an advisory lock.

