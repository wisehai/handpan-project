// Browser smoke tests: dialogs, library persistence, the SW update banner,
// and follow mode (fake mic stream + note-classifier self-test).
// Run with: node scripts/verify.mjs   (serves the repo root on :8934 itself)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8934;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/handpan-player.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ args: [
  '--use-fake-ui-for-media-stream',      // auto-grant the mic permission prompt
  '--use-fake-device-for-media-stream',  // synthetic mic input for follow mode
  '--autoplay-policy=no-user-gesture-required',
]});
const page = await browser.newPage();
const results = [];

async function check(name, fn){
  try { await fn(); results.push([name, 'PASS', '']); }
  catch (e){ results.push([name, 'FAIL', e.message]); }
}

await page.goto(`http://localhost:${PORT}/handpan-player.html`);
await page.waitForSelector('#btnLibSave');

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

await check('follow-mode classifier: clean notes + new note under sustain', async () => {
  const got = await page.evaluate(async () => {
    // Render through the real synthesis path, FFT windows the way the live
    // AnalyserNode sees them, and ask the classifier (linear magnitudes).
    const sr = 48000;
    buildFollowTemplates(sr);
    const fft = (re, im) => {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++){
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j |= bit;
        if (i < j){ [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
      }
      for (let len = 2; len <= n; len <<= 1){
        const ang = -2 * Math.PI / len;
        for (let i = 0; i < n; i += len){
          for (let k = 0; k < len / 2; k++){
            const c = Math.cos(ang * k), s = Math.sin(ang * k);
            const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
            const vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
            re[i + k + len / 2] = re[i + k] - vr; im[i + k + len / 2] = im[i + k] - vi;
            re[i + k] += vr; im[i + k] += vi;
          }
        }
      }
    };
    const render = async (hits, seconds) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
      const savedA = actx, savedM = master;
      actx = ctx;
      master = ctx.createGain(); master.gain.value = .7; master.connect(ctx.destination);
      for (const [key, t] of hits) playHit(key, t, 0.9);
      const rendered = await ctx.startRendering();
      actx = savedA; master = savedM;
      return rendered.getChannelData(0);
    };
    const linSpec = (data, startSec) => {
      const re = new Float32Array(FOLLOW_FFT), im = new Float32Array(FOLLOW_FFT);
      const start = Math.floor(startSec * sr);
      for (let i = 0; i < FOLLOW_FFT; i++){
        const w = .5 - .5 * Math.cos(2 * Math.PI * i / FOLLOW_FFT);   // Hann
        re[i] = (data[start + i] || 0) * w;
      }
      fft(re, im);
      const spec = new Float32Array(FOLLOW_FFT / 2);
      for (let i = 0; i < spec.length; i++) spec[i] = Math.hypot(re[i], im[i]);
      return spec;
    };
    const out = {};
    for (const key of ['2', '5', '8', 'D']){
      const data = await render([[key, 0.02]], 1);
      out[key] = classifyFollowSpectrum(linSpec(data, 0.02))[0].key;
    }
    // A '9' struck while '4' still rings: the raw post-onset spectrum is
    // contaminated, but the pre/post difference must isolate the '9'.
    const data = await render([['4', 0.02], ['9', 0.50]], 1.2);
    const pre = linSpec(data, 0.24), post = linSpec(data, 0.40);
    const delta = new Float32Array(pre.length);
    for (let i = 0; i < delta.length; i++) delta[i] = Math.max(0, post[i] - pre[i]);
    out.sustain = classifyFollowSpectrum(delta)[0].key;
    return out;
  });
  for (const want of ['2', '5', '8', 'D'])
    if (got[want] !== want) throw new Error(`played ${want}, classifier heard ${got[want]} (${JSON.stringify(got)})`);
  if (got.sustain !== '9') throw new Error(`9 struck under 4's sustain heard as ${got.sustain}`);
});

await check('follow mode: fake mic starts, UI collapses, exit restores', async () => {
  const barBefore = await page.evaluate(
    () => getComputedStyle(document.getElementById('followBar')).display);
  if (barBefore !== 'none') throw new Error(`follow bar visible outside follow mode (display: ${barBefore})`);
  await page.click('#btnFollow');
  await page.waitForSelector('body.follow', { timeout: 5000 });
  const state = await page.evaluate(() => ({
    mic: !!micAnalyser,
    barShown: !document.getElementById('followBar').hidden,
    panHidden: getComputedStyle(document.querySelector('.grid > .card:first-child')).display === 'none',
    trackFixed: getComputedStyle(document.getElementById('trackView')).position === 'fixed',
    cursorSet: !!document.querySelector('#trackView .col.now'),
  }));
  for (const [k, v] of Object.entries(state))
    if (!v) throw new Error(`after entering follow mode, ${k} is false`);
  await page.click('#btnFollowExit');
  await page.waitForFunction(() => !document.body.classList.contains('follow'));
  const after = await page.evaluate(() => ({ micGone: !micStream && !micAnalyser }));
  if (!after.micGone) throw new Error('mic stream still open after exiting follow mode');
});

await check('transport controls share one row on narrow phones', async () => {
  for (const width of [390, 360]){
    await page.setViewportSize({ width, height: 844 });
    for (const lang of ['en', 'zh']){    // label widths differ per language
      await page.evaluate(l => setLang(l), lang);
      const tops = await page.evaluate(() =>
        [...document.querySelectorAll('.transport > *')].map(el => el.offsetTop));
      if (tops.length < 4) throw new Error(`expected 4 transport controls, found ${tops.length}`);
      // centering can offset heterogeneous controls by a few px; a wrap is a full row (~38px)
      if (Math.max(...tops) - Math.min(...tops) > 15)
        throw new Error(`controls wrap at ${width}px (${lang}): offsetTops ${tops.join(',')}`);
    }
  }
  await page.evaluate(() => setLang('en'));
  await page.setViewportSize({ width: 1280, height: 720 });
});

await check('metronome ticks standalone while stopped', async () => {
  await page.locator('label:has(#chkMetro)').click();
  const on = await page.evaluate(() => ({ checked: chkMetro.checked, ticking: !!metroTimer }));
  if (!on.checked || !on.ticking) throw new Error(`after checking: ${JSON.stringify(on)}`);
  await page.locator('label:has(#chkMetro)').click();
  const off = await page.evaluate(() => ({ checked: chkMetro.checked, ticking: !!metroTimer }));
  if (off.checked || off.ticking) throw new Error(`after unchecking: ${JSON.stringify(off)}`);
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
