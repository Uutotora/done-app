import { defineConfig, devices } from '@playwright/test';

// Set PW_CHROMIUM_PATH to use a preinstalled Chromium instead of `npx playwright install`.
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    env: { DONE_DB_PATH: ':memory:' },
  },
});
