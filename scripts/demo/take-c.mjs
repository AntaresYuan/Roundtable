// Take C — video-plan step 12: open ai-logs/handoffs.jsonl "in an editor",
// scroll to today's real record, dwell on the context_audit field.
// Renders the actual file in an editor-styled HTML page (VS Code dark look,
// line numbers, Ctrl+F-style highlight on "context_audit").
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, openTake } from './lib.mjs';

const raw = readFileSync('ai-logs/handoffs.jsonl', 'utf8').trimEnd();
const lines = raw.split('\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colorize = (line) =>
  esc(line)
    .replace(/(&quot;|")((?:[^"\\]|\\.)*?)\1(\s*:)/g, '<span class="k">"$2"</span>$3')
    .replace(/: (".*?(?<!\\)")/g, ': <span class="s">$1</span>')
    .replace(/: (\d+(?:\.\d+)?)/g, ': <span class="n">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="b">$1</span>')
    .replace(/class="k">"context_audit"/g, 'class="k hl">"context_audit"');

const rows = lines
  .map((l, i) => `<tr><td class="ln">${i + 1}</td><td class="code">${colorize(l)}</td></tr>`)
  .join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #1e1e2e; color: #cdd6f4; font: 13px/1.6 "Cascadia Code", Consolas, monospace; }
  .titlebar { display: flex; align-items: center; gap: 8px; background: #181825; padding: 8px 14px;
    border-bottom: 1px solid #313244; position: sticky; top: 0; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .tab { margin-left: 14px; background: #1e1e2e; border: 1px solid #313244; border-bottom: none;
    border-radius: 6px 6px 0 0; padding: 5px 16px; font-size: 12px; color: #cdd6f4; }
  .tab .mod { color: #f9e2af; margin-left: 8px; }
  .crumbs { padding: 6px 18px; font-size: 11px; color: #6c7086; border-bottom: 1px solid #232334; }
  table { border-collapse: collapse; width: 100%; }
  td { vertical-align: top; padding: 3px 0; }
  .ln { color: #45475a; text-align: right; padding: 3px 16px 3px 22px; user-select: none; width: 1%; }
  .code { white-space: pre-wrap; word-break: break-all; padding-right: 26px; }
  .k { color: #89b4fa; } .s { color: #a6e3a1; } .n { color: #fab387; } .b { color: #cba6f7; }
  .hl { background: #f9e2af; color: #1e1e2e; border-radius: 2px; outline: 2px solid #f9e2af; }
  .statusbar { position: fixed; bottom: 0; left: 0; right: 0; background: #181825; color: #6c7086;
    font-size: 11px; padding: 4px 16px; display: flex; gap: 18px; border-top: 1px solid #313244; }
</style></head><body>
  <div class="titlebar">
    <span class="dot" style="background:#f38ba8"></span><span class="dot" style="background:#f9e2af"></span><span class="dot" style="background:#a6e3a1"></span>
    <span class="tab">handoffs.jsonl<span class="mod">●</span></span>
  </div>
  <div class="crumbs">ai-logs › handoffs.jsonl — runtime hand-off log (appended by the orchestrator, one JSON object per line)</div>
  <table>${rows}</table>
  <div style="height:120px"></div>
  <div class="statusbar"><span>JSON Lines</span><span>UTF-8</span><span>${lines.length} records</span><span style="margin-left:auto">${lines.length}:1</span></div>
</body></html>`;

const htmlPath = join(OUT, 'handoffs-viewer.html');
writeFileSync(htmlPath, html);

const { page, mark, done } = await openTake({ name: 'take-c-jsonl' });
mark('open viewer');
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.waitForTimeout(2200);

// Slow scroll from the top down to today's (last) record.
mark('scroll begin');
const total = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
for (let i = 1; i <= 24; i++) {
  await page.evaluate((y) => window.scrollTo({ top: y }), (total * i) / 24);
  await page.waitForTimeout(180);
}
mark('at today record');

// Dwell on the highlighted context_audit field (zoom happens in post).
const hl = page.locator('.hl').last();
await hl.scrollIntoViewIfNeeded();
await page.waitForTimeout(3500);
mark('context_audit dwell end');

await done();
