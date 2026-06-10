// Quick probe: dev login + homepage reachable, theater mode renders.
import { chromium } from '@playwright/test';

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
const EMAIL = 'demo@roundtable.local';

const browser = await chromium.launch();

// 1. logged-out theater
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE + '/');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'demo-out/probe-theater.png' });
  console.log('[theater] title=', await page.title());
  await page.close();
}

// 2. dev login via NextAuth sign-in page
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE + '/api/auth/signin');
  await page.screenshot({ path: 'demo-out/probe-signin.png' });
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.fill(EMAIL);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForURL(BASE + '/**', { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'demo-out/probe-loggedin.png' });
  const composer = page.getByPlaceholder(/Message the table/);
  console.log('[login] composer visible =', await composer.isVisible().catch(() => false));
  await page.context().storageState({ path: 'demo-out/auth-state.json' });
  console.log('[login] storage state saved');
  await page.close();
}

await browser.close();
console.log('PROBE OK');
