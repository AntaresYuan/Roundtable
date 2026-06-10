// Post-production: cut the takes by their marker files, speed up waits, apply
// close-up zooms, burn Chinese subtitles, lay the narration track, and concat
// everything into demo-out/roundtable-demo.mp4.
//
// Usage: node scripts/demo/assemble.mjs [--only 5]   (re-render one segment)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'demo-out';
const W = 1280, H = 800, FPS = 25;

// ---- locate ffmpeg/ffprobe (winget Gyan.FFmpeg.Essentials) -------------------
function findBin(name) {
  const roots = [join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')];
  for (const root of roots) {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('Gyan.FFmpeg')) continue;
      for (const sub of readdirSync(join(root, dir))) {
        const p = join(root, dir, sub, 'bin', `${name}.exe`);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error(`${name} not found`);
}
const FFMPEG = findBin('ffmpeg');
const FFPROBE = findBin('ffprobe');
const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const probeDur = (file) =>
  parseFloat(run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

// ---- markers ------------------------------------------------------------------
const markers = {};
for (const take of ['take-a-live', 'take-b-theater', 'take-c-jsonl']) {
  const file = join(OUT, `${take}.markers.json`);
  if (!existsSync(file)) continue;
  markers[take] = Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).map((m) => [m.label, m.ms / 1000]));
}
const at = (take, label) => {
  if (label === 'START') return 0;
  if (label === 'END') return probeDur(join(OUT, `${take}.webm`));
  const t = markers[take]?.[label];
  if (t === undefined) throw new Error(`marker not found: ${take} / ${label}`);
  return t;
};

// ---- EDL ------------------------------------------------------------------------
// clip: { between: [labelA, labelB], speed?: number | 'fit:<seconds>', zoom?: { z, cx, cy } }
// Marker semantics: each beat's mark fires when the beat ENDS, so footage for
// beat X spans [mark(prev beat), mark(X)].
const EDL = [
  { id: 1, take: 'take-a-live', clips: [{ between: ['START', 's01 panorama'], speed: 'fit:8' }] },
  { id: 2, take: 'take-a-live', clips: [{ between: ['s01 panorama', 's02 add agent'], speed: 'fit:14' }] },
  { id: 3, take: 'take-a-live', clips: [{ between: ['s02 add agent', 's04 plan card'], speed: 'fit:16' }] },
  {
    id: 4, take: 'take-a-live',
    clips: [
      { between: ['s04 plan card', 's05 approve'], speed: 1 },
      { between: ['s05 approve', 's05 resume'], speed: 'fit:11' },
    ],
  },
  {
    id: 5, take: 'take-a-live',
    clips: [
      { between: ['s05 resume', 's05 stages complete'], speed: 'fit:7' },
      { between: ['s05 stages complete', 's06 platform chip'], speed: 'fit:4' },
    ],
  },
  { id: 6, take: 'take-a-live', clips: [{ between: ['s06 platform chip', 's07 drawer'], speed: 'fit:12' }] },
  { id: 7, take: 'take-a-live', clips: [{ between: ['s07 drawer', 's08 follow-up send'], speed: 'fit:10' }] },
  {
    id: 8, take: 'take-a-live',
    clips: [{ between: ['s08 follow-up send', 's08 intake'], speed: 'fit:8', zoom: { z: 1.7, cx: 0.62, cy: 0.45 } }],
  },
  { id: 9, take: 'take-a-live', clips: [{ between: ['s08 intake', 's09 regenerate'], speed: 'fit:11' }] },
  {
    id: 10, take: 'take-b-theater',
    clips: [
      { between: ['goto gallery', 'handoff dwell end'], speed: 'fit:9' },
      { between: ['handoff dwell end', 'dep banner dwell end'], speed: 'fit:6', zoom: { z: 1.6, cx: 0.5, cy: 0.42 } },
    ],
  },
  { id: 11, take: 'take-a-live', clips: [{ between: ['s09 regenerate', 's11 workflow editor'], speed: 'fit:10' }] },
  {
    id: 12, take: 'take-c-jsonl',
    clips: [
      { between: ['START', 'at today record'], speed: 'fit:5' },
      { between: ['at today record', 'context_audit dwell end'], speed: 1, zoom: { z: 1.8, cx: 0.5, cy: 0.55 } },
    ],
  },
  { id: 13, take: 'take-a-live', clips: [{ between: ['s11 workflow editor', 's13 outro'], speed: 'fit:7' }] },
];

const narration = JSON.parse(readFileSync('scripts/demo/narration.json', 'utf8'));
const subFor = (id) => narration.segments.find((s) => s.id === id)?.sub ?? '';

const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc';
mkdirSync(OUT, { recursive: true });

const only = process.argv.includes('--only') ? Number(process.argv[process.argv.indexOf('--only') + 1]) : null;

const segFiles = [];
for (const seg of EDL) {
  const segFile = join(OUT, `segment-${String(seg.id).padStart(2, '0')}.mp4`);
  segFiles.push(segFile);
  if (only && seg.id !== only) continue;

  const src = join(OUT, `${seg.take}.webm`);
  const vo = join(OUT, `vo-${String(seg.id).padStart(2, '0')}.mp3`);
  const voDur = existsSync(vo) ? probeDur(vo) : 0;

  // Build per-clip filters.
  const parts = [];
  let clipTotal = 0;
  seg.clips.forEach((clip, i) => {
    const [a, b] = clip.between.map((l) => at(seg.take, l));
    const span = Math.max(0.2, b - a);
    let factor = 1;
    if (typeof clip.speed === 'number') factor = clip.speed;
    else if (typeof clip.speed === 'string' && clip.speed.startsWith('fit:')) {
      factor = Math.max(1, span / parseFloat(clip.speed.slice(4)));
    }
    clipTotal += span / factor;
    let z = '';
    if (clip.zoom) {
      const { z: zf, cx, cy } = clip.zoom;
      const cw = Math.round(W / zf / 2) * 2, ch = Math.round(H / zf / 2) * 2;
      const x = Math.round(Math.min(Math.max(cx * W - cw / 2, 0), W - cw));
      const y = Math.round(Math.min(Math.max(cy * H - ch / 2, 0), H - ch));
      z = `,crop=${cw}:${ch}:${x}:${y},scale=${W}:${H}:flags=lanczos`;
    }
    parts.push(
      `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${factor.toFixed(4)}${z},fps=${FPS},setsar=1[c${i}]`,
    );
  });

  const target = Math.max(clipTotal, voDur + 0.4);
  const pad = Math.max(0, target - clipTotal);

  // subtitle text file (avoids drawtext escaping issues)
  const subFile = join(OUT, `sub-${seg.id}.txt`);
  writeFileSync(subFile, subFor(seg.id), 'utf8');
  const drawtext =
    `drawtext=fontfile='${FONT}':textfile='${OUT}/sub-${seg.id}.txt':fontsize=27:fontcolor=white:` +
    `x=(w-text_w)/2:y=h-72:box=1:boxcolor=black@0.55:boxborderw=14`;

  const concatIns = seg.clips.map((_, i) => `[c${i}]`).join('');
  const filter =
    parts.join(';') +
    `;${concatIns}concat=n=${seg.clips.length}:v=1:a=0[cat];` +
    `[cat]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},${drawtext}[v];` +
    (existsSync(vo) ? `[1:a]apad[a]` : `anullsrc=r=48000:cl=mono,atrim=0:${target.toFixed(3)}[a]`);

  const args = ['-y', '-i', src];
  if (existsSync(vo)) args.push('-i', vo);
  args.push(
    '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-t', target.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    segFile,
  );
  console.log(`segment ${seg.id}: clips=${seg.clips.length} video=${clipTotal.toFixed(1)}s vo=${voDur.toFixed(1)}s -> ${target.toFixed(1)}s`);
  try {
    run(FFMPEG, args);
  } catch (e) {
    console.error(`segment ${seg.id} FAILED`);
    console.error(e.stderr?.toString().split('\n').slice(-40).join('\n'));
    process.exit(1);
  }
}

if (!only) {
  const list = join(OUT, 'concat.txt');
  writeFileSync(list, segFiles.map((f) => `file '${f.split('\\').pop()}'`).join('\n'));
  run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(OUT, 'roundtable-demo.mp4')]);
  console.log('FINAL:', join(OUT, 'roundtable-demo.mp4'), probeDur(join(OUT, 'roundtable-demo.mp4')).toFixed(1) + 's');
} else {
  console.log('(single segment mode — final concat skipped)');
}
