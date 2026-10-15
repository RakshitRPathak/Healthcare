import { createApp } from './app';
import { config } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { createQueues } from './jobs/queues';

const pool = createPool();
await migrate(pool);
const q = createQueues(config.redisUrl);
const server = createApp({ pool, jobs: q.jobs }).listen(config.port, () =>
  console.log(`API on :${config.port}  (run "npm run worker" for background jobs)`));

let closing = false;
async function shutdown(sig: string) {
  if (closing) return; closing = true;
  console.log(`${sig}: draining`);
  const force = setTimeout(() => process.exit(1), 10_000); force.unref();       // never hang a deploy
  await new Promise<void>((r) => server.close(() => r()));                       // stop accepting, finish in-flight requests
  await q.close().catch(() => {}); await pool.end().catch(() => {});
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => void shutdown(s));
