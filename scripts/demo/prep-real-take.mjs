// Pre-flight for the real Take A:
//  1. wipe local live turns (dry runs polluted the single local chat)
//  2. remove the dry-run agent "Rex" from the workbench members
//  3. verify the Volcano endpoint is reachable (VPN must be OFF)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';

// 1. reset live turns (server reads the file per request — no restart needed)
writeFileSync('.roundtable/local-turns.json', '{}\n');
console.log('local turn store wiped');

// 2. remove Rex via the members rail
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: 'demo-out/auth-state.json' });
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForTimeout(3000);
for (const name of ['Rex']) {
  const row = page.getByText(name, { exact: true }).first();
  if (await row.count()) {
    await row.hover();
    const remove = page.locator(`[title="Remove ${name}"]`).first();
    if (await remove.count()) {
      await remove.click();
      console.log(`removed agent ${name}`);
      await page.waitForTimeout(800);
    } else {
      console.log(`remove button for ${name} not found`);
    }
  } else {
    console.log(`agent ${name} not present`);
  }
}
await page.reload();
await page.waitForTimeout(2500);
console.log('members now:', (await page.locator('text=/@(architect|planner|implementer|reviewer|fixer)/').allInnerTexts()).join(', '));
await browser.close();

// 3. LLM endpoint reachability (DeepSeek official API — works with VPN on)
try {
  const res = await fetch('https://api.deepseek.com', { method: 'GET', signal: AbortSignal.timeout(10_000) });
  console.log('deepseek reachable, HTTP', res.status, '(any code is fine)');
} catch (e) {
  console.log('DEEPSEEK UNREACHABLE — check network before recording!', String(e.cause ?? e).slice(0, 120));
  process.exitCode = 1;
}
