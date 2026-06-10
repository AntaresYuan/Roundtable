// Take A — the live golden-path master take (video-plan steps 1-9, 11, 13).
// One continuous logged-in session; markers.json drives the post cut.
// Aborts early if the plan card is degraded (heuristic fallback) — that take
// would be unusable per the storyboard pre-flight.
import { readFileSync } from 'node:fs';
import { BASE, openTake, glide, glideClick, typeSlow } from './lib.mjs';

// Server-side truth for dispatch progress — the UI's Regenerate button shows
// for interrupted turns too, so it is not a completion signal.
function latestTurn() {
  try {
    const turns = JSON.parse(readFileSync('.roundtable/local-turns.json', 'utf8'));
    return Object.values(turns).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  } catch {
    return undefined;
  }
}

const PROMPT = '做一个产品定价页，含月付/年付切换';
const FOLLOW_UP = '把切换做成能记住用户的选择';
const AGENT_NAME = process.env.DEMO_AGENT_NAME || 'Iris';

const { page, mark, done } = await openTake({
  name: 'take-a-live',
  storageState: 'demo-out/auth-state.json',
});

// Dispatch through the real Claude Code adapter (platform chip + real artifacts).
await page.addInitScript(() => {
  window.localStorage.setItem('roundtableAgentAdapter', 'claude-code');
});

let fatal = false;
async function beat(label, fn, watchdogMs = 150_000) {
  if (fatal) return;
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('beat watchdog fired')), watchdogMs)),
    ]);
    mark(label);
  } catch (e) {
    mark(`${label} FAILED: ${String(e.message ?? e).split('\n')[0]}`);
    const slug = label.replace(/[^a-z0-9]+/gi, '-');
    await page.screenshot({ path: `demo-out/fail-${slug}.png` }).catch(() => {});
    // Close any modal/menu the failed beat left behind so later beats aren't blocked.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }
}

const composer = () => page.getByPlaceholder(/Message the table/);

// ---- s01: homepage panorama --------------------------------------------------
await beat('s01 panorama', async () => {
  await page.goto(BASE + '/');
  await page.waitForTimeout(3500);
  // cursor sweep over the members rail
  await glide(page, page.getByText('Members', { exact: false }).first(), { dwell: 300 });
  await glide(page, page.getByText('New task').first(), { dwell: 600 });
  await page.waitForTimeout(1200);
});

// ---- s02: build a custom agent -----------------------------------------------
await beat('s02 add agent', async () => {
  await glideClick(page, page.getByRole('button', { name: /add an agent/i }));
  await page.waitForTimeout(900);
  const reviewer = page.getByRole('button', { name: /^@reviewer/i }).first();
  await glideClick(page, reviewer);
  await page.waitForTimeout(500);
  // pressSequentially focuses the element itself — no raw .click() (the UI
  // re-renders on focus/hover and raw clicks hang in Playwright's retry loop)
  const nameInput = page.locator('input[type="text"]:not([placeholder*="Search"]), input:not([type]):not([placeholder*="Search"])').first();
  await glide(page, nameInput, { dwell: 250 });
  await nameInput.selectText().catch(() => {});
  await typeSlow(nameInput, AGENT_NAME, 90);
  const promptBox = page.locator('textarea').first();
  await glide(page, promptBox, { dwell: 250 });
  await typeSlow(promptBox, 'You review pricing pages for clarity and a11y.', 38);
  for (const cap of ['Tool use', 'File edits']) {
    await glideClick(page, page.getByText(cap, { exact: true }).first(), { dwell: 250 });
  }
  await page.waitForTimeout(400);
  // the modal overflows the 800px viewport — scroll its footer into view
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(500);
  await glideClick(page, page.getByRole('button', { name: /add to workbench/i }));
  await page.waitForTimeout(1800); // new contact row appears (zoom in post)
});

// ---- s03: mention menu + send the build prompt --------------------------------
await beat('s03 mention + prompt', async () => {
  await glide(page, page.getByText('New task').first(), { dwell: 700 });
  const box = composer();
  await glide(page, box, { dwell: 300 });
  await typeSlow(box, '@', 80);
  await page.waitForTimeout(1300); // mention menu visible
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(700);
  await typeSlow(box, PROMPT, 65);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
});

// ---- s04: PM drafts the plan (keep the wait), Show plan ------------------------
await beat('s04 plan card', async () => {
  await page.getByText(/Drafting the plan/).last().waitFor({ timeout: 20_000 });
  await page.getByText(/\d+\/\d+ done/).last().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);
  if (await page.getByText(/heuristic planner/i).count()) {
    if (process.env.DEMO_ALLOW_DEGRADED === '1') {
      mark('degraded plan tolerated (dry run)');
    } else {
      fatal = true;
      mark('FATAL degraded plan (heuristic fallback) — abort take');
      return;
    }
  }
  await glideClick(page, page.getByRole('button', { name: /show plan/i }).last());
  await page.waitForTimeout(2600);
  await glideClick(page, page.getByRole('button', { name: /hide plan/i }).last());
  await page.waitForTimeout(600);
});

// ---- s05: approve → stop → interrupt card → resume → stages run ----------------
await beat('s05 approve', async () => {
  const approve = page.getByRole('button', { name: 'Approve', exact: true }).last();
  await glideClick(page, approve);
  // verify server-side; re-click once if the first click was eaten by a re-render
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500);
    if (latestTurn()?.approvalStatus === 'approved') return;
    if (i === 6) await approve.evaluate((el) => el.click()).catch(() => {});
  }
  throw new Error('approval never registered server-side');
});
await beat('s05 stop', async () => {
  await page.getByRole('button', { name: /^Stop$/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000); // let the Build stage card breathe first
  await glideClick(page, page.getByRole('button', { name: /^Stop$/ }));
});
await beat('s05 interrupt card', async () => {
  await page.getByText('Run interrupted').waitFor({ timeout: 30_000 });
  await glide(page, page.getByRole('button', { name: /hand off to different agent/i }), { dwell: 1200 });
  await page.waitForTimeout(1200); // Resume / Hand off / Discard on screen
});
await beat('s05 resume', async () => {
  await glideClick(page, page.getByRole('button', { name: /^Resume$/ }));
});
await beat('s05 stages complete', async () => {
  // Wait for the run to finish — poll the server-side turn store.
  const deadline = Date.now() + 900_000;
  for (;;) {
    const turn = latestTurn();
    if (turn?.dispatchStatus === 'completed') break;
    if (turn?.dispatchStatus === 'failed') throw new Error(`dispatch failed: ${turn.dispatchError ?? ''}`);
    if (Date.now() > deadline) throw new Error('dispatch did not complete in 15min');
    await page.waitForTimeout(5000);
  }
  mark(`s05 dispatch adapter = ${latestTurn()?.dispatchAdapter}`);
  await page.waitForTimeout(3500); // UI polling catches up; stage cards flip to done
}, 940_000);

// ---- s06: platform chip -------------------------------------------------------
await beat('s06 platform chip', async () => {
  await glide(page, page.locator('[title^="Coding-agent platform"]').first(), { dwell: 1600 });
});

// ---- s07: artifacts in the chat thread — copy, preview interaction, drawer ------
await beat('s07 copy code', async () => {
  const copy = page.locator('[title="Copy code"]').last();
  await copy.waitFor({ timeout: 20_000 });
  await copy.scrollIntoViewIfNeeded();
  await glideClick(page, copy, { dwell: 700 });
  await page.waitForTimeout(1600); // green check (zoom in post)
});
await beat('s07 preview interact', async () => {
  const previewTab = page.getByRole('button', { name: /^Preview$/ }).last();
  if (await previewTab.count()) await glideClick(page, previewTab, { dwell: 400 });
  const frame = page.frameLocator('iframe').last();
  const toggle = frame.locator('text=/annual|yearly|年付|年/i').first();
  await toggle.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await toggle.click({ timeout: 8000 });
  await page.waitForTimeout(1400);
  const monthly = frame.locator('text=/monthly|月付|月/i').first();
  if (await monthly.count()) { await monthly.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200); }
});
await beat('s07 drawer', async () => {
  await glideClick(page, page.getByRole('button', { name: /open in drawer/i }).last());
  await page.waitForTimeout(2200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
});

// ---- s08: pin + vague follow-up → intake understands context -------------------
await beat('s08 pin pm message', async () => {
  const pmMsg = page.getByText(/I drafted a .*plan/i).last();
  await glide(page, pmMsg, { dwell: 500 });
  const pin = page.locator('[title="Pin as long-term context"]').first();
  await glideClick(page, pin, { dwell: 600 });
  await page.waitForTimeout(1200);
});
await beat('s08 follow-up send', async () => {
  const box = composer();
  await glide(page, box, { dwell: 300 });
  await typeSlow(box, FOLLOW_UP, 65);
  await page.keyboard.press('Enter');
  await page.getByText(/Drafting the plan/).last().waitFor({ timeout: 20_000 });
});
await beat('s08 intake', async () => {
  await page.getByText(/\d+\/\d+ done/).nth(1).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(3200); // dwell on intake summary (zoom in post)
});

// ---- s09: IM montage — search / pin / archive / quote / regenerate -------------
await beat('s09 search', async () => {
  const search = page.getByPlaceholder(/Search tasks/);
  await glide(page, search, { dwell: 300 });
  await typeSlow(search, 'real', 110);
  await page.waitForTimeout(1300);
  await search.fill('');
  await page.waitForTimeout(500);
});
await beat('s09 pin task', async () => {
  const row = page.getByText('Realtime chat feature').last();
  await glide(page, row, { dwell: 500 });
  await glideClick(page, page.locator('[title*="Pin to top" i], [title*="pin to top" i]').first(), { dwell: 400 });
  await page.waitForTimeout(900);
});
await beat('s09 archive', async () => {
  // hover the row again — pin re-rendered the rail and dropped hover state
  const row = page.getByText('Realtime chat feature').last();
  await glide(page, row, { dwell: 600 });
  const archiveBtn = page.locator('[title*="rchive"]').first();
  await glideClick(page, archiveBtn, { dwell: 400 });
  await page.waitForTimeout(700);
  const archived = page.getByText(/Archived ·/).first();
  if (await archived.count()) { await glideClick(page, archived, { dwell: 300 }); await page.waitForTimeout(900); }
});
await beat('s09 quote', async () => {
  const msg = page.getByText(/I drafted a .*plan/i).first();
  await glide(page, msg, { dwell: 400 });
  await glideClick(page, page.locator('[title="Quote in reply"]').first(), { dwell: 400 });
  await page.waitForTimeout(1300); // "> ..." injected into composer
  await composer().fill('');
});
await beat('s09 regenerate', async () => {
  await glideClick(page, page.getByRole('button', { name: /regenerate/i }).last(), { dwell: 400 });
  await page.waitForTimeout(1500);
});

// ---- s11: workflow editor -------------------------------------------------------
await beat('s11 workflow editor', async () => {
  await glideClick(page, page.locator('button[title="Workflow"]').first(), { dwell: 500 });
  await page.waitForTimeout(1800);
  const mover = page.locator('button[title="Move later"]:enabled, button[title="Move earlier"]:enabled').first();
  if (await mover.count()) { await glideClick(page, mover, { dwell: 500 }); await page.waitForTimeout(1100); }
  const configure = page.getByRole('button', { name: /configure/i }).first();
  if (await configure.count()) {
    await glideClick(page, configure, { dwell: 400 });
    await page.waitForTimeout(900);
    const gate = page.getByText(/your approval/i).first();
    if (await gate.count()) { await glideClick(page, gate, { dwell: 600 }); }
    await page.waitForTimeout(2200);
    await page.mouse.click(120, 400); // backdrop closes the stage drawer
    await page.waitForTimeout(600);
  }
});

// ---- s13: back to the table, outro ----------------------------------------------
await beat('s13 outro', async () => {
  await glideClick(page, page.locator('button[title="Roundtable"]').first(), { dwell: 400 });
  await page.waitForTimeout(4000);
});

await page.screenshot({ path: 'demo-out/take-a-final.png' });
await done();
