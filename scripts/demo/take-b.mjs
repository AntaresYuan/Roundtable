// Take B — fixture "script theater" shots (video-plan step 10, marked SCRIPT):
// inline HandoffCard expanded + dependency-changed badge on the downstream
// artifact card. Recorded against /gallery, which renders the same product
// components from fixtures.
import { BASE, openTake, glide, glideClick } from './lib.mjs';

const { page, mark, done } = await openTake({ name: 'take-b-theater' });

mark('goto gallery');
await page.goto(BASE + '/gallery');
await page.waitForTimeout(2500);

// Shot 1: HandoffCard — bring into view, expand, dwell on structured fields.
const handoff = page.locator('text=hand-off').first();
await glide(page, handoff, { dwell: 800 });
mark('handoff card in view');
await handoff.click();
await page.waitForTimeout(800);
mark('handoff expanded');
// Slow scroll through the expanded card (userIntent, taskBrief, context audit).
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 130); await page.waitForTimeout(550); }
await page.waitForTimeout(2500);
mark('handoff dwell end');

// Shot 2: dependency-changed badge + banner on the downstream file card,
// next to the diff card.
const badge = page.locator('[title="Upstream dependency changed"]').first();
await glide(page, badge, { dwell: 900 });
mark('dep badge in view');
const banner = page.locator('text=/changed/i').first();
await glide(page, banner, { dwell: 600 });
await page.waitForTimeout(2800);
mark('dep banner dwell end');

// Bonus: the diff card right below (kind: 'diff', vera's review fix).
const diff = page.getByText('Artifacts — file / diff / preview');
await glide(page, diff, { dwell: 300 });
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(450); }
await page.waitForTimeout(1500);
mark('diff card pan end');

await done();
