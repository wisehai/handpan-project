// Browser smoke tests for the app shell, recorded instrument, persistence,
// and service-worker update path.
// Run with: node scripts/verify.mjs   (serves the repo root on :8934 itself)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8934;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.m4a': 'audio/mp4' };

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/handpan-player.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const results = [];

async function check(name, fn){
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (e){ results.push([name, 'FAIL', e.message]); }
}

await page.goto(`http://localhost:${PORT}/handpan-player.html`);
await page.waitForSelector('#btnLibSave');

await check('six recorded sprites load and decode', async () => {
  const state = await page.evaluate(async () => {
    ensureCtx();
    return {
      preloaded: await samplePreloadPromise,
      decoded: await prepareSampleBuffers(),
      sprites: sampleManifest?.sprites.length,
      buffers: sampleBuffers.size,
      ding: sampleManifest?.sprites.every(sprite => !!sprite.cues.D),
    };
  });
  if (!state.preloaded || !state.decoded || state.sprites !== 6 || state.buffers !== 6 || !state.ding)
    throw new Error(JSON.stringify(state));
});

await check('dialog centered (not top-left)', async () => {
  await page.click('#btnLibSave');
  await page.waitForSelector('#saveDlg[open]');
  const box = await page.locator('#saveDlg').boundingBox();
  const vw = page.viewportSize().width;
  if (box.x < 5 && box.y < 5) throw new Error(`dialog pinned at (${box.x},${box.y})`);
  const centerX = box.x + box.width / 2;
  if (Math.abs(centerX - vw / 2) > 20) throw new Error(`not horizontally centered: centerX=${centerX} vw/2=${vw/2}`);
  if (box.y < 10) throw new Error(`dialog too close to top: y=${box.y}`);
  await page.click('#btnSaveCancel');
});

await check('delete restores default score', async () => {
  const defaultText = await page.locator('#scoreText').inputValue();
  await page.click('#btnLibSave');
  await page.fill('#saveName', 'Verify Test Score');
  await page.click('#btnSaveOk');
  await page.selectOption('#libSel', { label: 'Verify Test Score' });
  await page.click('#btnLibDel');   // arm
  await page.click('#btnLibDel');   // confirm
  const after = await page.locator('#scoreText').inputValue();
  if (after !== defaultText) throw new Error('scoreText did not reset to the builtin default after delete');
});

await check('SW update banner appears after CACHE_NAME bump + reload', async () => {
  const swPath = join(ROOT, 'sw.js');
  const original = await readFile(swPath, 'utf8');
  try {
    // Step 1: reload so this page becomes controlled by whatever SW is currently on disk.
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 8000 });
    // Step 2: simulate a deploy by bumping CACHE_NAME, then reload to trigger an update check.
    const bumped = original.replace(/CACHE_NAME = '([^']+)'/, (m, v) => `CACHE_NAME = '${v}-verify'`);
    if (bumped === original) throw new Error('could not find CACHE_NAME in sw.js to bump');
    await writeFile(swPath, bumped);
    await page.reload();
    await page.waitForFunction(
      () => document.getElementById('updateBanner') && document.getElementById('updateBanner').hidden === false,
      { timeout: 8000 }
    );
  } finally {
    await writeFile(swPath, original);
  }
});

await browser.close();
server.close();

for (const [name, status, msg] of results){
  console.log(`[${status}] ${name}${msg ? ' - ' + msg : ''}`);
}
process.exit(results.some(r => r[1] === 'FAIL') ? 1 : 0);
