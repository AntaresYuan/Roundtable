// Shared helpers for the demo video recorder (docs/demo/video-plan.md).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3001';
export const OUT = join(process.cwd(), 'demo-out');
export const VIEWPORT = { width: 1280, height: 800 };

// Renders a fake cursor + click ripple; Playwright videos don't include the OS pointer.
const CURSOR_INIT = `(() => {
  if (window.__rtCursor) return; window.__rtCursor = true;
  const add = () => {
    if (!document.body) return;
    const c = document.createElement('div');
    c.id = 'rt-demo-cursor';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;width:20px;height:20px;z-index:2147483647;pointer-events:none;';
    c.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 1 L3 16 L7.2 12.4 L9.8 18 L12.2 16.9 L9.6 11.4 L15 11 Z" fill="#1a1a2e" stroke="#fff" stroke-width="1.3"/></svg>';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;width:34px;height:34px;border-radius:50%;border:2.5px solid #6957d2;' +
        'left:' + (e.clientX - 17) + 'px;top:' + (e.clientY - 17) + 'px;z-index:2147483646;pointer-events:none;' +
        'animation:rtRipple .45s ease-out forwards;';
      document.body.appendChild(r); setTimeout(() => r.remove(), 500);
    }, true);
    if (!document.getElementById('rt-demo-ripple-css')) {
      const s = document.createElement('style'); s.id = 'rt-demo-ripple-css';
      s.textContent = '@keyframes rtRipple{from{transform:scale(.4);opacity:.9}to{transform:scale(1.25);opacity:0}}';
      document.head.appendChild(s);
    }
  };
  if (document.readyState !== 'loading') add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

export async function openTake({ name, storageState }) {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT, size: VIEWPORT },
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(CURSOR_INIT);
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = [];
  const mark = (label) => {
    const ms = Date.now() - t0;
    marks.push({ label, ms });
    console.log(`[${name}] ${(ms / 1000).toFixed(1)}s  ${label}`);
  };
  const done = async () => {
    const video = page.video();
    await context.close();
    const tmp = await video.path();
    const dest = join(OUT, `${name}.webm`);
    try { renameSync(tmp, dest); } catch { /* already moved */ }
    await browser.close();
    writeFileSync(join(OUT, `${name}.markers.json`), JSON.stringify(marks, null, 2));
    console.log(`[${name}] saved ${dest} (+ markers)`);
  };
  return { page, mark, done };
}

// Human-ish mouse travel to a locator (so the fake cursor visibly glides).
export async function glide(page, locator, { dwell = 400 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('glide: no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await page.waitForTimeout(dwell);
  return box;
}

export async function glideClick(page, locator, opts) {
  await glide(page, locator, opts);
  try {
    await locator.click({ timeout: 4000 });
  } catch {
    // This UI re-renders on hover/click (inline-style React), which detaches
    // nodes mid-click and traps Playwright in its retry loop even though the
    // click landed. Fall back to a direct DOM click.
    await locator.evaluate((el) => el.click());
  }
}

// Type with per-key delay so the composer beat reads naturally on video.
export async function typeSlow(locator, text, delay = 55) {
  await locator.pressSequentially(text, { delay });
}

export function newestWebm() {
  return readdirSync(OUT).filter((f) => f.endsWith('.webm')).sort().at(-1);
}
