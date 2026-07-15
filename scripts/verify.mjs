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

await check('follow controls: numeric sensitivity + D/T and chord progress matching', async () => {
  const state = await page.evaluate(() => {
    sensSlider.value = '1.5';
    sensSlider.dispatchEvent(new Event('input', { bubbles: true }));
    setLang('zh');
    return {
      shown: sensValue.value,
      saved: localStorage.getItem('handpan_sens'),
      candidates: tr('followHeard', 'T', 'D'),
      dFromT: followExpectedMatches([{key:'D'}], ['T']),
      tFromD: followExpectedMatches([{key:'T'}], ['D']),
      chordEither: followExpectedMatches([{key:'4'}, {key:'8'}], ['8']),
      chordMiss: followExpectedMatches([{key:'4'}, {key:'8'}], ['5']),
    };
  });
  if (state.shown !== '1.5' || state.saved !== '1.5')
    throw new Error(`sensitivity value not synchronized: ${JSON.stringify(state)}`);
  if (state.candidates !== '识别到 T（次选 D）')
    throw new Error(`candidate status missing runner-up: ${state.candidates}`);
  if (!state.dFromT || !state.tFromD || !state.chordEither || state.chordMiss)
    throw new Error(`progress matching is wrong: ${JSON.stringify(state)}`);
  await page.evaluate(() => setLang('en'));
});

await check('score tempo directives drive per-event BPM and scale UI', async () => {
  const originalScore = await page.locator('#scoreText').inputValue();
  try {
    const state = await page.evaluate(() => {
      scoreText.value = '@BPM 120\nR: D . D .\nL: . 1 . 1\n\n@BPM 60\nR: D .\nL: . 1';
      applyScore();
      bpmSlider.value = '50';
      bpmSlider.dispatchEvent(new Event('input', {bubbles:true}));
      const savedPlayHit = playHit;
      let scheduledIntervals = [];
      try {
        playHit = () => {};
        chkMetro.checked = false;
        ensureCtx();
        playing = true; pos = 0;
        nextTime = actx.currentTime - 3;
        stopAtTime = Infinity; visQueue = [];
        scheduler();
        scheduledIntervals = visQueue.slice(1).map((v, i) =>
          Number((v.time - visQueue[i].time).toFixed(3)));
      } finally {
        playHit = savedPlayHit;
        stopPlay(true);
      }
      return {
        eventBpms: events.map(e => e.scoreBpm),
        changes: tempoChanges,
        dynamic: bpmControlDynamic,
        label: bpmLabelEl.textContent,
        output: bpmValEl.textContent,
        max: bpmSlider.max,
        firstActual: tempoAt(0).actual,
        laterActual: tempoAt(4).actual,
        firstDur: eighthDur(0),
        laterDur: eighthDur(4),
        scheduledIntervals,
        markers: [...document.querySelectorAll('#trackView .vlabel')].map(el => el.textContent),
      };
    });
    if (state.eventBpms.join(',') !== '120,120,120,120,60,60')
      throw new Error(`wrong event BPM map: ${state.eventBpms}`);
    if (!state.dynamic || state.label !== 'Tempo scale' || state.output !== '50%' || state.max !== '150')
      throw new Error(`scale UI not configured: ${JSON.stringify(state)}`);
    if (state.firstActual !== 60 || state.laterActual !== 30 ||
        state.firstDur !== 0.5 || state.laterDur !== 1)
      throw new Error(`scaled tempo math is wrong: ${JSON.stringify(state)}`);
    if (state.scheduledIntervals.join(',') !== '0.5,0.5,0.5,0.5,1')
      throw new Error(`scheduler ignored tempo transition: ${state.scheduledIntervals}`);
    if (!state.markers.includes('♩ = 120 BPM') || !state.markers.includes('♩ = 60 BPM'))
      throw new Error(`tempo markers not rendered: ${state.markers}`);
  } finally {
    await page.evaluate(score => { scoreText.value = score; applyScore(); }, originalScore);
  }
  // A directive-free score must flip the UI back to plain BPM mode (the
  // built-in default now carries @BPM, so test the transition explicitly).
  const restored = await page.evaluate(() => {
    scoreText.value = 'R: D . D .\nL: . 1 . 1';
    applyScore();
    return {dynamic: bpmControlDynamic, label: bpmLabelEl.textContent};
  });
  await page.evaluate(score => { scoreText.value = score; applyScore(); }, originalScore);
  if (restored.dynamic || restored.label !== 'Tempo BPM')
    throw new Error(`plain BPM UI was not restored: ${JSON.stringify(restored)}`);
});

await check('PDF recognition preserves measure-number progress labels', async () => {
  const originalScore = await page.locator('#scoreText').inputValue();
  try {
    await page.evaluate(() => {
      setLang('zh');
      // Start from a directive-free score so the first import exercises the
      // plain -> 100% scale-mode transition (the default score has @BPM now).
      // Reset tempoScale after the mode switch: configureBpmControl saves the
      // outgoing slider value into it when leaving scale mode.
      scoreText.value = 'R: D .\nL: . 1';
      applyScore();
      tempoScale = 100;
    });
    const pdfs = [
      ['Notepan - Pocket Groove 11.pdf', [110]],
      ['Pocket Groove 10.pdf', [118]],
      ['Sam Maher - New York.pdf', [95, 85, 45, 123, 50]],
    ];
    for (const [name, expectedBpms] of pdfs){
      await page.evaluate(() => { lastStatus = null; });
      await page.setInputFiles('#pdfFile', join(ROOT, 'test', '测试谱子', name));
      await page.waitForFunction(
        () => lastStatus && lastStatus.msgKey === 'pdfDone', null, { timeout: 30000 });
      const result = await page.locator('#scoreText').inputValue();
      const labels = result.split('\n').filter(line => line.startsWith('# 小节 '));
      if (!labels.length) throw new Error(`${name}: no measure labels recognized`);
      if (labels[0] !== '# 小节 1 · 2')
        throw new Error(`${name}: unexpected first label ${JSON.stringify(labels[0])}`);
      if (labels.length < 4)
        throw new Error(`${name}: expected several measure labels, found ${labels.length}`);
      const bpms = [...new Set(
        result.split('\n').filter(line => /^@BPM \d+$/.test(line)).map(line => Number(line.slice(5))))];
      for (const bpm of expectedBpms)
        if (!bpms.includes(bpm)) throw new Error(`${name}: BPM ${bpm} not recognized (${bpms})`);
      const tempoUi = await page.evaluate(() => ({dynamic:bpmControlDynamic, value:bpmValEl.textContent}));
      if (!tempoUi.dynamic || tempoUi.value !== '100%')
        throw new Error(`${name}: imported tempo did not activate 100% scale mode`);
      if (name.startsWith('Sam Maher')){
        const early = await page.evaluate(() => tempoChanges.filter(t => t.bpm === 85 || t.bpm === 45));
        if (early.length < 2 || early[0].evIdx >= early[1].evIdx)
          throw new Error(`${name}: mid-system tempo changes were not ordered (${JSON.stringify(early)})`);
      }
    }
  } finally {
    await page.evaluate(score => {
      scoreText.value = score;
      applyScore();
      dirty = false;
      setLang('en');
    }, originalScore);
  }
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
  await page.waitForTimeout(50);   // let the rAF-scheduled row-band recompute settle
  const after = await page.evaluate(() => ({ micGone: !micStream && !micAnalyser }));
  if (!after.micGone) throw new Error('mic stream still open after exiting follow mode');
});

await check('row bands: zebra stripes + current-row highlight', async () => {
  await page.click('#btnFollow');
  await page.waitForSelector('body.follow', { timeout: 5000 });
  try {
    const state = await page.evaluate(() => {
      const bands = [...document.querySelectorAll('#trackBands .rowband')];
      const cur = document.querySelector('#trackView .col.now');
      return {
        count: bands.length,
        hasOdd: bands.some(b => b.classList.contains('rowband-odd')),
        hasEven: bands.some(b => !b.classList.contains('rowband-odd')),
        curRow: cur && cur.dataset.row,
        nowRowMatchesCur: cur && !!document.querySelector(
          '#trackBands .rowband[data-row="' + cur.dataset.row + '"].now-row'),
      };
    });
    if (state.count < 4) throw new Error(`expected several row bands, found ${state.count}`);
    if (!state.hasOdd || !state.hasEven) throw new Error('row bands are not alternating');
    if (state.curRow === undefined || state.curRow === null) throw new Error('current .col.now has no data-row');
    if (!state.nowRowMatchesCur) throw new Error('current row band is missing .now-row');
  } finally {
    if (await page.locator('body.follow').count()){
      await page.click('#btnFollowExit');
      await page.waitForFunction(() => !document.body.classList.contains('follow'));
    }
  }
});

await check('follow mode: tapping a column jumps the cursor, never plays audio', async () => {
  await page.click('#btnFollow');
  await page.waitForSelector('body.follow', { timeout: 5000 });
  const target = await page.evaluate(() => {
    // pick a playable (non-rest) column a bit further in than the cursor
    const cols = [...document.querySelectorAll('#trackView .col')];
    const cur = document.querySelector('#trackView .col.now');
    const curIdx = cur ? cols.indexOf(cur) : 0;
    let col = null;
    for (let i = Math.min(cols.length - 1, curIdx + 20); i < cols.length; i++)
      if (events[Number(cols[i].dataset.event)].hits.length){ col = cols[i]; break; }
    col.click();
    return Number(col.dataset.event);
  });
  const after = await page.evaluate(() => ({
    playing, followPos,
    curEvt: Number((document.querySelector('#trackView .col.now') || {}).dataset?.event),
  }));
  if (after.playing) throw new Error('clicking a column during follow mode started playback');
  if (after.curEvt !== target) throw new Error(`expected cursor at ${target}, got ${after.curEvt}`);
  await page.click('#btnFollowExit');
  await page.waitForFunction(() => !document.body.classList.contains('follow'));
});

await check('follow mode centers the active row; normal mode edge-clamps', async () => {
  await page.evaluate(() => { followPos = 0; });
  await page.click('#btnFollow');
  await page.waitForSelector('body.follow', { timeout: 5000 });
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++){
      const idx = followTargetIdx();
      if (idx < 0) break;
      followAdvance(idx);
    }
  });
  await page.waitForTimeout(500);   // let the smooth scroll settle
  const centered = await page.evaluate(() => {
    const s = document.querySelector('#trackView .col.now');
    const r = s.getBoundingClientRect(), box = document.getElementById('trackView').getBoundingClientRect();
    return Math.abs((r.top + r.height / 2) - (box.top + box.height / 2));
  });
  if (centered > 40) throw new Error(`active row not centered in follow mode: ${centered}px off-center`);
  await page.click('#btnFollowExit');
  await page.waitForFunction(() => !document.body.classList.contains('follow'));
});

await check('follow mode scrolls only when the physical row changes', async () => {
  await page.click('#btnFollow');
  await page.waitForSelector('body.follow', { timeout: 5000 });
  try {
    const calls = await page.evaluate(() => {
      const view = document.getElementById('trackView');
      const cols = [...view.querySelectorAll('.col')];
      const current = view.querySelector('.col.now');
      const same = cols.find(c => c !== current && c.dataset.row === current.dataset.row);
      const other = cols.find(c => c.dataset.row !== current.dataset.row);
      if (!same || !other) throw new Error('score did not produce multiple physical rows');
      const original = view.scrollBy;
      let count = 0;
      view.scrollBy = () => { count++; };
      lastFollowRow = current.dataset.row;
      highlightToken(Number(same.dataset.event));
      const withinRow = count;
      highlightToken(Number(other.dataset.event));
      const afterRowChange = count;
      view.scrollBy = original;
      return {withinRow, afterRowChange};
    });
    if (calls.withinRow !== 0 || calls.afterRowChange !== 1)
      throw new Error(`unexpected scroll calls: ${JSON.stringify(calls)}`);
  } finally {
    if (await page.locator('body.follow').count()){
      await page.click('#btnFollowExit');
      await page.waitForFunction(() => !document.body.classList.contains('follow'));
    }
  }
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
