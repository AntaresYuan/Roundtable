import { chromium } from '@playwright/test';
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: 'demo-out/auth-state.json' });
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForTimeout(3500);
try {
  const btn = page.getByRole('button', { name: /add an agent/i });
  console.log('count:', await btn.count());
  await btn.click({ timeout: 8000 });
  console.log('clicked Add an agent');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'demo-out/s02-modal.png' });
  const radios = await page.locator('button, [role=radio], label').evaluateAll((els) =>
    els.filter((e) => /@(architect|planner|implementer|reviewer|fixer)/.test(e.innerText || '')).map((e) => ({
      tag: e.tagName, text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    })),
  );
  console.log('role options:', JSON.stringify(radios));
  const caps = await page.locator('button').evaluateAll((els) =>
    els.filter((e) => /Streaming|Tool use|File edits|Sessions|MCP|Multimodal/i.test(e.innerText || '')).map((e) => (e.innerText || '').trim()),
  );
  console.log('capability toggles:', JSON.stringify(caps));
  // can we reach the footer button?
  const submit = page.getByRole('button', { name: /add to workbench/i });
  console.log('submit count:', await submit.count(), 'box:', JSON.stringify(await submit.boundingBox()));
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(600);
  console.log('after wheel box:', JSON.stringify(await submit.boundingBox()));
  await submit.click({ timeout: 5000 });
  console.log('SUBMIT CLICKED');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'demo-out/s02-after-submit.png' });
} catch (e) {
  console.log('FAIL:', e.message);
  await page.screenshot({ path: 'demo-out/s02-fail.png' });
}
await browser.close();
