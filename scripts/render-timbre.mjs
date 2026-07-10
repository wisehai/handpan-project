// Render the app's real Web Audio graph for offline analysis.
// Usage: node scripts/render-timbre.mjs [output-directory] [keys/modes...]
// Modes: SCALE (all notes in sequence), DEFAULT (the current score), ALL (one chord).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(process.argv[2] || '/tmp/handpan-app-renders');
const KEYS = process.argv.length > 3 ? process.argv.slice(3) :
  ['1','2','3','4','5','6','7','8','9','10','11','D','T','S'];
const PORT = 8935;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.png': 'image/png',
};

await mkdir(OUT, { recursive: true });

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/handpan-player.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

const browser = await chromium.launch();

try {
  for (const key of KEYS) {
    // A fresh page releases each large AudioBuffer before rendering the next note.
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(120000);
    await page.goto(`http://localhost:${PORT}/handpan-player.html`);
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async key => {
      const sampleRate = 48000;
      const scoreStep = 30 / 110;
      const seconds = key === 'SCALE' ? 40 :
        (key === 'DEFAULT' ? Math.min(75, Math.max(12, events.length * scoreStep + 6)) : 8.5);
      const ctx = new OfflineAudioContext(2, sampleRate * seconds, sampleRate);
      actx = ctx;
      createOutputGraph(ctx, 0.85);
      if (!(await prepareSampleBuffers(ctx))) throw new Error('recorded sample assets did not decode');
      if (key === 'SCALE') {
        ['1','2','3','4','5','6','7','8','9','10','11','D','T','S']
          .forEach((hit, i) => playHit(hit, 0.05 + i * 2.35, 0.85));
      } else if (key === 'DEFAULT') {
        events.forEach((event, i) => event.hits.forEach(hit => playHit(hit.key, 0.05 + i * scoreStep, 0.85)));
      } else {
        const hits = key === 'ALL' ? ['1','2','3','4','5','6','7','8','9','10','11','D','T','S'] : [key];
        for (const hit of hits) playHit(hit, 0.05, 0.9);
      }
      const rendered = await ctx.startRendering();

      const channels = rendered.numberOfChannels;
      const frames = rendered.length;
      const bytesPerSample = 2;
      const dataBytes = frames * channels * bytesPerSample;
      const wav = new ArrayBuffer(44 + dataBytes);
      const view = new DataView(wav);
      const ascii = (offset, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
      };
      ascii(0, 'RIFF');
      view.setUint32(4, 36 + dataBytes, true);
      ascii(8, 'WAVE');
      ascii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * channels * bytesPerSample, true);
      view.setUint16(32, channels * bytesPerSample, true);
      view.setUint16(34, bytesPerSample * 8, true);
      ascii(36, 'data');
      view.setUint32(40, dataBytes, true);
      const audio = Array.from({ length: channels }, (_, ch) => rendered.getChannelData(ch));
      let offset = 44;
      for (let frame = 0; frame < frames; frame++) {
        for (let ch = 0; ch < channels; ch++) {
          const value = Math.max(-1, Math.min(1, audio[ch][frame]));
          view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true);
          offset += bytesPerSample;
        }
      }

      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      link.download = `${key}.wav`;
      link.click();
    }, key);
    const download = await downloadPromise;
    await download.saveAs(join(OUT, `${key}.wav`));
    await page.close();
    console.log(`Rendered ${key}.wav`);
  }
} finally {
  await browser.close();
  server.close();
}
