import { chromium } from '@playwright/test';
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: 'demo-out/auth-state.json' });
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForTimeout(4000);
await page.screenshot({ path: 'demo-out/ui-loggedin.png' });

const buttons = await page.locator('button').evaluateAll((els) =>
  els.map((e) => ({
    text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    title: e.title || '',
    aria: e.getAttribute('aria-label') || '',
    visible: !!(e.offsetWidth || e.offsetHeight),
  })).filter((b) => b.visible && (b.text || b.title || b.aria)),
);
console.log(JSON.stringify(buttons, null, 1));
await browser.close();
