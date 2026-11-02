# CLAUDE.md

Context for working on **Wordsel**, a Wordle clone for legacy HP/Palm webOS
(Pre phones, TouchPad tablet). See `README.md` for the user-facing overview.

## What this is

A faithful Wordle port that keeps the original's word data + logic but rebuilds
the UI for the ancient webOS WebKit. App id `com.codepoet.wordsel`, packaged as
an Enyo 1.0 web app via the Palm SDK.

## Architecture

Framework-independent core + thin Enyo shell. Load order is set in `depends.js`:

```
source/words.js   -> WORDS_ANSWERS (2315) + WORDS_ALLOWED (10657), verbatim from original Wordle
source/game.js    -> WordleGame: solutionForDate, isValidWord, evaluateGuess, aggregateKeyStates, isWin
source/storage.js -> Storage: generic JSON get/set/remove + game save/load/clear (localStorage -> cookie)
source/stats.js   -> WordleStats: record/load, streak + guess-distribution logic
source/ui.js      -> WordleUI.mount(node): all DOM UI (board, keyboard, animations, toast, stats modal)
source/Updater-Helper.js -> Helpers.Updater Enyo kind: App Museum II update check + Preware install (synced from webos-common; don't hand-edit)
source/App.js     -> Enyo 1.0 kind; create() runs Updater.CheckForUpdate("Wordsel"); rendered() calls WordleUI.mount(this.hasNode())
source/styles.css -> hardcoded-color CSS, -webkit-box layout, animation keyframes, modal
```

The core (`words`, `game`, `stats`, `storage`) has **no DOM/framework deps** and
self-exports under `module.exports` for Node testing. `ui.js` is plain DOM only.
Enyo is used *only* as the webOS shell — do not push game UI into Enyo kinds.

## Key invariants / decisions

- **ES5 only.** No arrow fns, `let`/`const`, template strings, classes,
  `classList`, `dataset`, `Array.fill`/`includes`, `String.padStart`.
- **Daily schedule matches classic Wordle:** epoch `new Date(2021,5,19)` = index
  0 = "cigar". `dayIndex = round((midnight(today)-midnight(epoch))/86400000)`,
  answer = `WORDS_ANSWERS[dayIndex % 2315]`. Don't change the epoch.
- **Scoring is the exact original two-pass** (correct pass consumes letters,
  then present pass) so duplicate letters score right. Verified against historic
  answers (cigar, rebut, 2022-01-01 = rebus).
- A guess is valid if it's in `WORDS_ANSWERS` **or** `WORDS_ALLOWED`.
- Stats use a **double-count guard** keyed by `dayIndex` so replaying a day
  (via the dev reset) doesn't inflate counts. Streak extends only when the
  previous completion was the immediately preceding day.
- Game state is saved per `dayIndex`; restoring a finished game shows the board
  and auto-opens stats **without** re-recording.

## webOS WebKit quirks (these bit us — keep them in mind)

- `-webkit-box-flex` does **NOT** grow children to fill; it only honors content
  width. The keyboard fills via `min-width` on keys + `box-pack: center`, not
  flex growth. (A `width:0 + box-flex` attempt made the keys vanish; a
  `display:table` attempt collapsed them — both reverted.)
- A bare text node inside a `-webkit-box` mis-aligns (letter drifted right).
  Center single chars with `text-align` + `line-height` (= tile height minus
  borders, since tiles are `border-box`), not box centering.
- Use only glyphs in the device font — backspace key reads `DEL`, not `⌫`.
- No CSS custom properties; colors are hardcoded from the Wordle palette
  (green `#6aaa64`, yellow `#c9b458`, gray `#787c7e`).

## Testing

No formal harness in-repo, but the core + UI can be driven under Node with a
minimal DOM shim (createElement/createTextNode/appendChild, `node.style`,
`getAttribute`, synchronous `setTimeout`, fake `localStorage`/`document.cookie`),
loading the source files into a shared `vm` context. This has been used to
verify scoring vs. historic answers, the full play/win/lose/restore flow,
animation class cleanup, and stats/streak math.

There is no on-device automated test — the Enyo shell + CSS rendering must be
checked in the actual webOS browser/emulator.

## Build / run

```sh
palm-package .
palm-install com.codepoet.wordsel_1.0.0_all.ipk
```

`.ipk` is git-ignored. Icons: `icon.png` (app), `icon-256.png` (splash).

## Dev affordances to remember

- **Double-tap the WORDSEL title** = reset today's puzzle (replays same word;
  leaves stats alone). This is a testing-only feature — strip before a public
  release if undesired.

## App menu / dark mode

`App.js` hosts an Enyo `AppMenu` with a "Dark Mode" `MenuCheckItem`. It calls
`WordleUI.toggleDarkMode()`, which toggles a `wb-dark` class on `<body>` and
persists `{darkMode: bool}` under `Storage.NS + "prefs"`. All dark colors live
in the "Dark mode" section of `styles.css` (incl. `*-dark` flip keyframes, since
the light ones hardcode the white starting tile).

## Deferred / not yet built

Emoji share string, colorblind mode, hard mode. The original bundle
had all of these; logic can be re-derived if needed.
