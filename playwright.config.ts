import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:43210',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'NEXTAUTH_URL=http://localhost:43210 NEXTAUTH_SECRET=roundtable-e2e-secret corepack pnpm exec next dev -p 43210',
    url: 'http://localhost:43210',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
