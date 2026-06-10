// Generate Chinese narration audio per segment via Edge neural TTS
// (msedge-tts, installed in C:/Users/glqi6/dev/demo-tools).
// Usage: node scripts/demo/tts.mjs   → demo-out/vo-<id>.mp3
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('file:///C:/Users/glqi6/dev/demo-tools/');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const { voice, segments } = JSON.parse(readFileSync('scripts/demo/narration.json', 'utf8'));
mkdirSync('demo-out', { recursive: true });

const tts = new MsEdgeTTS();
await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

for (const seg of segments) {
  const { audioStream } = tts.toStream(seg.vo);
  const chunks = [];
  await new Promise((resolve, reject) => {
    audioStream.on('data', (c) => chunks.push(c));
    audioStream.on('end', resolve);
    audioStream.on('error', reject);
  });
  const out = `demo-out/vo-${String(seg.id).padStart(2, '0')}.mp3`;
  writeFileSync(out, Buffer.concat(chunks));
  console.log(out, Buffer.concat(chunks).length, 'bytes');
}
console.log('TTS done');
