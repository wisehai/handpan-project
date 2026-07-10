# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single self-contained HTML file (`handpan-player.html`) implementing a browser-based handpan
(D Kurd 8+1 / "Pocket Groove 11") player: SVG pan visualization, Web Audio synthesis, and an
editable two-row text score format. No build step, no package manager, no test runner — all
HTML/CSS/JS lives in this one file. The only external dependency is pdf.js, lazy-loaded from a
CDN at runtime when the user imports a PDF score.

## Running / testing

There is no build or test command. To work on it, just open the file directly in a browser:

```bash
xdg-open handpan-player.html   # or: open handpan-player.html on macOS
```

Verify changes manually in-browser (click pads/T-ring/shell, edit the score textarea and click
"应用乐谱", use play/stop/loop/metronome). There is no automated test suite.

## Architecture

Everything is in one `<script>` block in `handpan-player.html`, organized top-to-bottom as:

1. **Note table (`NOTES`)** — maps score tokens (`D`, `T`, `1`-`8`) to note name, frequency, and
   ring angle. `D` is the center Ding, `T` is the shoulder tone (own ring, no pad), `S` (slap) is
   handled separately since it's unpitched and has no entry in `NOTES`.

2. **SVG pan construction (`buildPan`)** — builds the visual pan procedurally from `NOTES`
   angles; `padEls` maps every key (`1`-`8`, `T`, `S`) to its SVG group for click handling and
   flash animations (`flashPad`).

3. **Audio engine** — plain Web Audio API, no libraries. `playHit` synthesizes tonal notes
   (fundamental + partials + noise transient), `playSlap` synthesizes the unpitched slap sound,
   `playTick` drives the metronome. All hits go through a single `master` gain node → dynamics
   compressor → destination.

4. **Score format & parser (`parseScore`)** — the core data model to understand before editing
   scoring/playback logic:
   - Two-row notation: an `R:` line (right hand) paired with the following `L:` line (left hand),
     column-aligned; one column = one eighth note. A lone line with no `R:`/`L:` prefix is treated
     as legacy single-hand notation.
   - Tokens: `D` Ding, `1`-`8` tone fields, `T` shoulder, `S` slap, `.` rest, `|` barline (display
     only, doesn't advance time), `#` comment/section label line. `+` joins simultaneous notes in
     one column (e.g. `1+4`); a hand-hit combines with the row's hand unless `legacy`, in which
     case hand is `null` (played as neutral/right-colored).
   - Parsing produces two parallel structures: `events` (flat list of `{hits:[{key,hand}]}`, one
     per eighth note — this is what the scheduler plays) and `blocks` (display structure with
     labels/columns/barlines — this is what `renderTrack` draws in `#trackView`). Keep these in
     sync if you change parsing: `evIdx` in a block column must index into `events`.
   - Mismatched R/L column counts push a warning into `parseWarnings` and pad the shorter row with
     rests rather than failing.

5. **Scheduler (`scheduler`/`visLoop`)** — standard lookahead audio scheduler pattern:
   `scheduler()` runs on a `setInterval` timer and schedules audio events up to `LOOKAHEAD_S`
   ahead using `actx.currentTime`; `visLoop()` runs on `requestAnimationFrame` and fires the
   visual flash/highlight for events whose scheduled time has arrived. Audio timing must always
   come from `actx.currentTime`, not `setTimeout`/`setInterval` timestamps, to stay sample-accurate.

6. **PDF recognition (`recognizePdf`)** — pure-geometry, no ML/OCR. Reads the PDF's text layer via
   pdf.js, keeps single-char glyphs matching note tokens, clusters them into rows by y-coordinate
   (`clusterRows`), pairs adjacent rows into an R/L "system" (`systemToLines`), and quantizes x
   onto an eighth-note grid to reconstruct `R:`/`L:` score lines. Only works on vector PDFs with a
   real text layer (e.g. Notepan-exported scores) — scanned/rasterized PDFs have no text layer and
   will report zero systems found.

7. **Persistence** — two independent mechanisms: plain `.txt` export/import (works everywhere,
   the reliable fallback), and an in-browser "曲库" (score library) backed by `localStorage`
   under key `handpan_scores_v1`, which self-hides (`libRow.style.display = 'none'`) when
   `localStorage` is unavailable (sandboxed previews, private browsing).

## Conventions in this file

- UI text and score comments are in Chinese (zh-CN); keep new user-facing strings consistent with
  that unless asked otherwise.
- No frameworks, no bundler, no external JS dependencies besides the lazily-loaded pdf.js. Keep it
  that way — the whole point is a single portable HTML file.
- The per-note `TIMBRE` table (partial ratios, amplitudes, decay fractions) is measured from
  recordings of the owner's actual pan (`test/r1.m4a`, `test/r2.m4a` — spectral analysis, two
  takes cross-checked). These are real acoustic observations, not arbitrary constants; don't
  simplify them away or collapse notes back onto a shared partial set.
