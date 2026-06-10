import { chromium } from '@playwright/test';
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE + '/');
await page.waitForTimeout(2500);
const composer = page.getByPlaceholder(/Message the table/);
await composer.fill('run the golden path');
await page.keyboard.press('Enter');
console.log('sent');
await page.waitForTimeout(8000);
console.log('hand-off @8s:', await page.locator('text=hand-off').count());
await page.waitForTimeout(20_000);
console.log('hand-off @28s:', await page.locator('text=hand-off').count(),
  '| dep:', await page.locator('text=/dependency changed/i').count(),
  '| DEP:', await page.locator('text=/DEP CHANGED/i').count());
await page.screenshot({ path: 'demo-out/theater-played.png' });
await browser.close();
