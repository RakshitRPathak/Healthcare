import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// In locked-down sandboxes a browser may be preinstalled; otherwise Playwright's own download (`npx playwright install chromium`) is used.
const pre = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
export default defineConfig({
  testDir: 'e2e', timeout: 90_000, fullyParallel: false, workers: 1, retries: 0, reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1280, height: 860 }, trace: 'retain-on-failure',
         launchOptions: existsSync(pre) ? { executablePath: pre, args: ['--no-sandbox'] } : {} },
  webServer: [
    { command: 'sh e2e/start-server.sh', url: 'http://localhost:3100/health', timeout: 90_000, reuseExistingServer: false },
    { command: 'sh e2e/start-worker.sh', port: undefined, timeout: 10_000, reuseExistingServer: false, wait: { stdout: /worker up/ } },
    { command: 'npm run build && VITE_PROXY_TARGET=http://localhost:3100 npx vite preview --port 5174 --strictPort', url: 'http://localhost:5174', timeout: 120_000, reuseExistingServer: false },
  ],
});
