/*
 * ui.js -- Wordsel UI, built with plain DOM so it runs on legacy webOS WebKit.
 *
 * Deliberately framework-free: WordleUI.mount(rootNode) builds the board, the
 * on-screen keyboard, the message toast, and the statistics modal inside the
 * supplied element and wires up both touch/click and hardware-keyboard input.
 * The Enyo shell (App.js) owns the webOS chrome and hands us a node to render
 * into.
 *
 * Depends on globals: WordleGame (game.js), WordleStats (stats.js),
 *                     Storage (storage.js).
 *
 * ES5 only, and avoids APIs missing from old WebKit: no classList, no dataset,
 * no Array.fill/includes, no template strings, no arrow functions. Animations
 * use -webkit-* transforms/keyframes (CSS), and degrade gracefully to instant
 * color changes if unsupported.
 */

var WordleUI = (function () {
  "use strict";

  var WORD_LENGTH = WordleGame.WORD_LENGTH;   /* 5 */
  var MAX_GUESSES = WordleGame.MAX_GUESSES;   /* 6 */

  /* animation timing (kept in sync with styles.css) */
  var FLIP_STAGGER = 300;   /* ms between consecutive tiles flipping */
  var FLIP_DURATION = 500;  /* ms for one tile's flip */
  var POP_MS = 120;
  var SHAKE_MS = 600;

  var KEY_ROWS = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["enter", "z", "x", "c", "v", "b", "n", "m", "backspace"]
  ];

  /* ---- small DOM helpers (no classList on old WebKit) ---- */
  function el(tag, className) {
    var n = document.createElement(tag);
    if (className) { n.className = className; }
    return n;
  }
  function text(node, value) {
    if (node.firstChild) { node.firstChild.nodeValue = value; }
    else { node.appendChild(document.createTextNode(value)); }
  }
  function hasClass(node, c) {
    return (" " + node.className + " ").indexOf(" " + c + " ") >= 0;
  }
  function addClass(node, c) {
    if (!hasClass(node, c)) {
      node.className = node.className ? node.className + " " + c : c;
    }
  }
  function removeClass(node, c) {
    var parts = (node.className || "").split(" "), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && parts[i] !== c) { out.push(parts[i]); }
    }
    node.className = out.join(" ");
  }
  function setStateClass(node, baseClass, stateClass) {
    node.className = baseClass + (stateClass ? " " + stateClass : "");
  }
  function setAnimDelay(node, ms) {
    var v = ms ? ms + "ms" : "";
    node.style.WebkitAnimationDelay = v;
    node.style.animationDelay = v;
  }

  /* ---- module state ---- */
  var root = null;
  var tiles = [];        /* tiles[row][col] -> DOM node */
  var rowNodes = [];     /* rowNodes[row]   -> DOM node */
  var keyNodes = {};     /* letter/"enter"/"backspace" -> DOM node */
  var messageNode = null;
  var messageTimer = null;
  var modalNodes = null; /* stats modal node references */
  var canInput = true;   /* locked during the flip reveal */

  var state = null;      /* see newState() */

  function newState(dayIndex, solution) {
    return {
      dayIndex: dayIndex,
      solution: solution,
      guesses: [],
      evaluations: [],
      current: "",
      rowIndex: 0,
      status: "playing"   /* "playing" | "won" | "lost" */
    };
  }

  /* ---- build DOM ---- */
  function buildBoard(parent) {
    var board = el("div", "wb-board");
    tiles = [];
    rowNodes = [];
    for (var r = 0; r < MAX_GUESSES; r++) {
      var rowNode = el("div", "wb-row");
      var rowTiles = [];
      for (var c = 0; c < WORD_LENGTH; c++) {
        var t = el("div", "wb-tile");
        rowNode.appendChild(t);
        rowTiles.push(t);
      }
      board.appendChild(rowNode);
      tiles.push(rowTiles);
      rowNodes.push(rowNode);
    }
    parent.appendChild(board);
  }

  function buildKeyboard(parent) {
    var kb = el("div", "wb-keyboard");
    keyNodes = {};
    for (var r = 0; r < KEY_ROWS.length; r++) {
      var rowNode = el("div", "wb-kbrow");
      var row = KEY_ROWS[r];
      for (var i = 0; i < row.length; i++) {
        var key = row[i];
        var wide = (key === "enter" || key === "backspace");
        var k = el("button", "wb-key" + (wide ? " wb-key-wide" : ""));
        k.setAttribute("type", "button");
        k.setAttribute("data-key", key);
        k.appendChild(document.createTextNode(
          key === "enter" ? "ENTER" : key === "backspace" ? "DEL" : key.toUpperCase()
        ));
        rowNode.appendChild(k);
        keyNodes[key] = k;
      }
      kb.appendChild(rowNode);
    }
    kb.onclick = function (e) {
      var target = e.target || e.srcElement;
      while (target && target !== kb) {
        var key = target.getAttribute && target.getAttribute("data-key");
        if (key) { handleKey(key); return; }
        target = target.parentNode;
      }
    };
    parent.appendChild(kb);
  }

  /* ---- rendering from state ---- */
  function renderTile(r, c) {
    var node = tiles[r][c];
    var letter = "";
    var stateClass = "";
    if (r < state.guesses.length) {
      letter = state.guesses[r].charAt(c);
      stateClass = "wb-" + state.evaluations[r][c];
    } else if (r === state.rowIndex) {
      letter = state.current.charAt(c) || "";
      if (letter) { stateClass = "wb-filled"; }
    }
    setStateClass(node, "wb-tile", stateClass);
    setAnimDelay(node, 0);
    text(node, letter ? letter.toUpperCase() : "");
  }

  function renderRow(r) {
    for (var c = 0; c < WORD_LENGTH; c++) { renderTile(r, c); }
  }

  function renderBoard() {
    for (var r = 0; r < MAX_GUESSES; r++) { renderRow(r); }
  }

  function renderKeyboard() {
    var states = WordleGame.aggregateKeyStates(state.guesses, state.evaluations);
    for (var key in keyNodes) {
      if (!keyNodes.hasOwnProperty(key)) { continue; }
      if (key === "enter" || key === "backspace") { continue; }
      var s = states[key];
      setStateClass(keyNodes[key], "wb-key", s ? "wb-key-" + s : "");
    }
  }

  /* ---- messages ---- */
  function showMessage(msg, persist) {
    if (messageTimer) { window.clearTimeout(messageTimer); messageTimer = null; }
    text(messageNode, msg);
    addClass(messageNode, "wb-message-show");
    if (!persist) {
      messageTimer = window.setTimeout(function () {
        messageNode.className = "wb-message";
        messageTimer = null;
      }, 1500);
    }
  }

  /* ---- animations ---- */
  /* Flip-reveal a finished row tile-by-tile, then call onDone(). The per-state
     keyframes (wb-flip + wb-correct/present/absent in CSS) swap the tile color
     at the midpoint of the flip. If animations aren't supported the color
     class alone still shows the result immediately. */
  function revealRow(r, onDone) {
    var evals = state.evaluations[r];
    var guess = state.guesses[r];
    var total = (WORD_LENGTH - 1) * FLIP_STAGGER + FLIP_DURATION;
    for (var c = 0; c < WORD_LENGTH; c++) {
      var node = tiles[r][c];
      text(node, guess.charAt(c).toUpperCase());
      node.className = "wb-tile wb-" + evals[c] + " wb-flip";
      setAnimDelay(node, c * FLIP_STAGGER);
    }
    window.setTimeout(function () {
      for (var c2 = 0; c2 < WORD_LENGTH; c2++) {
        var n = tiles[r][c2];
        n.className = "wb-tile wb-" + evals[c2];
        setAnimDelay(n, 0);
      }
      if (onDone) { onDone(); }
    }, total + 60);
  }

  function bounceRow(r) {
    for (var c = 0; c < WORD_LENGTH; c++) {
      var node = tiles[r][c];
      addClass(node, "wb-bounce");
      setAnimDelay(node, c * 100);
    }
  }

  function popTile(r, c) {
    var node = tiles[r][c];
    addClass(node, "wb-pop");
    window.setTimeout(function () {
      /* only strip the pop if the tile is still the in-progress filled tile */
      if (hasClass(node, "wb-pop")) {
        node.className = "wb-tile wb-filled";
      }
    }, POP_MS);
  }

  function shakeRow(r) {
    var node = rowNodes[r];
    addClass(node, "wb-shake");
    window.setTimeout(function () {
      node.className = "wb-row";
    }, SHAKE_MS);
  }

  /* ---- input handling ---- */
  function handleKey(key) {
    if (state.status !== "playing" || !canInput) { return; }
    if (key === "enter") { submitGuess(); }
    else if (key === "backspace") { removeLetter(); }
    else if (key.length === 1 && key >= "a" && key <= "z") { addLetter(key); }
  }

  function addLetter(ch) {
    if (state.current.length >= WORD_LENGTH) { return; }
    var c = state.current.length;
    state.current += ch;
    renderTile(state.rowIndex, c);
    popTile(state.rowIndex, c);
  }

  function removeLetter() {
    if (state.current.length === 0) { return; }
    state.current = state.current.substring(0, state.current.length - 1);
    renderTile(state.rowIndex, state.current.length);
  }

  function submitGuess() {
    var guess = state.current;
    if (guess.length < WORD_LENGTH) {
      showMessage("Not enough letters");
      shakeRow(state.rowIndex);
      return;
    }
    if (!WordleGame.isValidWord(guess)) {
      showMessage("Not in word list");
      shakeRow(state.rowIndex);
      return;
    }

    var evaluation = WordleGame.evaluateGuess(guess, state.solution);
    state.guesses.push(guess);
    state.evaluations.push(evaluation);
    state.current = "";
    var submittedRow = state.rowIndex;
    state.rowIndex += 1;
    Storage.save(state);

    canInput = false;
    revealRow(submittedRow, function () {
      renderKeyboard();

      if (WordleGame.isWin(evaluation)) {
        state.status = "won";
        Storage.save(state);
        var praises = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];
        showMessage(praises[submittedRow] || "Well done", true);
        bounceRow(submittedRow);
        finishGame(true, submittedRow + 1);
      } else if (state.rowIndex >= MAX_GUESSES) {
        state.status = "lost";
        Storage.save(state);
        showMessage(state.solution.toUpperCase(), true);
        finishGame(false, 0);
      } else {
        canInput = true;
      }
    });
  }

  /* Record stats for a just-completed (live) game and reveal the modal. */
  function finishGame(won, numGuesses) {
    var stats = WordleStats.record(won, numGuesses, state.dayIndex);
    var highlight = won ? numGuesses : -1;
    window.setTimeout(function () {
      showStats(stats, highlight);
    }, 1400);
  }

  function onKeyDown(e) {
    var code = e.keyCode || e.which;
    if (code === 13) { handleKey("enter"); }
    else if (code === 8) {
      handleKey("backspace");
      if (e.preventDefault) { e.preventDefault(); } else { e.returnValue = false; }
    } else if (code >= 65 && code <= 90) {
      handleKey(String.fromCharCode(code).toLowerCase());
    } else if (code >= 97 && code <= 122) {
      handleKey(String.fromCharCode(code));
    }
  }

  /* ---- statistics modal ---- */
  function buildModal(parent) {
    var overlay = el("div", "wb-modal-overlay");
    var modal = el("div", "wb-modal");

    var h = el("h2", "wb-modal-title");
    text(h, "STATISTICS");
    modal.appendChild(h);

    var statsRow = el("div", "wb-stats");
    var cells = {};
    var defs = [["played", "Played"], ["win", "Win %"],
                ["cur", "Current Streak"], ["max", "Max Streak"]];
    for (var i = 0; i < defs.length; i++) {
      var cell = el("div", "wb-stat");
      var num = el("div", "wb-stat-num");
      text(num, "0");
      var lab = el("div", "wb-stat-label");
      text(lab, defs[i][1]);
      cell.appendChild(num);
      cell.appendChild(lab);
      statsRow.appendChild(cell);
      cells[defs[i][0]] = num;
    }
    modal.appendChild(statsRow);

    var dh = el("h3", "wb-dist-title");
    text(dh, "GUESS DISTRIBUTION");
    modal.appendChild(dh);

    var dist = el("div", "wb-dist");
    var bars = [];
    for (var g = 0; g < MAX_GUESSES; g++) {
      var drow = el("div", "wb-dist-row");
      var label = el("div", "wb-dist-label");
      text(label, String(g + 1));
      var track = el("div", "wb-dist-track");
      var bar = el("div", "wb-dist-bar");
      text(bar, "0");
      track.appendChild(bar);
      drow.appendChild(label);
      drow.appendChild(track);
      dist.appendChild(drow);
      bars.push(bar);
    }
    modal.appendChild(dist);

    var close = el("button", "wb-modal-close");
    close.setAttribute("type", "button");
    text(close, "CLOSE");
    close.onclick = hideStats;
    modal.appendChild(close);

    overlay.appendChild(modal);
    /* click outside the modal card closes it */
    overlay.onclick = function (e) {
      var t = e.target || e.srcElement;
      if (t === overlay) { hideStats(); }
    };
    parent.appendChild(overlay);

    modalNodes = { overlay: overlay, cells: cells, bars: bars };
  }

  function showStats(stats, highlight) {
    if (!stats) { stats = WordleStats.load(); }
    if (typeof highlight !== "number") { highlight = -1; }
    var cells = modalNodes.cells;
    text(cells.played, String(stats.played));
    text(cells.win, String(WordleStats.winPercent(stats)));
    text(cells.cur, String(stats.currentStreak));
    text(cells.max, String(stats.maxStreak));

    var maxCount = 1, i;
    for (i = 0; i < stats.dist.length; i++) {
      if (stats.dist[i] > maxCount) { maxCount = stats.dist[i]; }
    }
    for (i = 0; i < modalNodes.bars.length; i++) {
      var bar = modalNodes.bars[i];
      var count = stats.dist[i] || 0;
      var pct = Math.round((count / maxCount) * 100);
      if (pct < 8) { pct = 8; } /* keep the number readable */
      bar.style.width = pct + "%";
      text(bar, String(count));
      setStateClass(bar, "wb-dist-bar", (i + 1) === highlight ? "wb-dist-current" : "");
    }
    addClass(modalNodes.overlay, "wb-modal-show");
  }

  function hideStats() {
    modalNodes.overlay.className = "wb-modal-overlay";
  }

  /* ---- restore a saved game (no animation, no stats recording) ---- */
  function restore(saved) {
    state.guesses = saved.guesses || [];
    state.evaluations = saved.evaluations || [];
    state.rowIndex = state.guesses.length;
    state.current = "";
    state.status = saved.status || "playing";
    if (state.status === "lost") {
      showMessage(state.solution.toUpperCase(), true);
    }
  }

  /* Dev/testing reset: wipe the saved game and restart today's puzzle in place.
     (Stats are intentionally left untouched.) */
  function resetGame() {
    Storage.clear();
    state = newState(state.dayIndex, state.solution);
    if (messageTimer) { window.clearTimeout(messageTimer); messageTimer = null; }
    messageNode.className = "wb-message";
    canInput = true;
    renderBoard();
    renderKeyboard();
    showMessage("Reset");
  }

  /* ---- theme (dark mode) ---- */
  /* The "wb-dark" class goes on <body> so the page background and every
     descendant (board, keyboard, toast, stats modal) pick up the dark rules in
     styles.css. The choice is saved under Storage.NS + "prefs". */
  var PREFS_KEY = Storage.NS + "prefs";
  var darkMode = false;

  function loadPrefs() {
    var p = Storage.get(PREFS_KEY);
    return (p && typeof p === "object") ? p : {};
  }

  function applyTheme() {
    var body = document.body;
    if (!body) { return; }
    if (darkMode) { addClass(body, "wb-dark"); }
    else { removeClass(body, "wb-dark"); }
  }

  function setDarkMode(on) {
    darkMode = !!on;
    var p = loadPrefs();
    p.darkMode = darkMode;
    Storage.set(PREFS_KEY, p);
    applyTheme();
    return darkMode;
  }

  function isDarkMode() { return darkMode; }

  function toggleDarkMode() { return setDarkMode(!darkMode); }

  /* ---- public ---- */
  function mount(rootNode) {
    root = rootNode;
    canInput = true;
    while (root.firstChild) { root.removeChild(root.firstChild); }
    addClass(root, "wb-app");
    darkMode = !!loadPrefs().darkMode;
    applyTheme();

    var header = el("div", "wb-header");
    var title = el("h1", "wb-title");
    text(title, "WORDSEL");
    /* double-tap the title to reset today's puzzle (testing affordance) */
    var lastTap = 0;
    title.onclick = function () {
      var now = (new Date()).getTime();
      if (now - lastTap < 400) { lastTap = 0; resetGame(); }
      else { lastTap = now; }
    };
    header.appendChild(title);

    var statsBtn = el("button", "wb-stats-btn");
    statsBtn.setAttribute("type", "button");
    text(statsBtn, "STATS");
    statsBtn.onclick = function () { showStats(WordleStats.load(), -1); };
    header.appendChild(statsBtn);
    root.appendChild(header);

    messageNode = el("div", "wb-message");
    text(messageNode, "");
    root.appendChild(messageNode);

    buildBoard(root);
    buildKeyboard(root);
    buildModal(root);

    var today = new Date();
    var dayIndex = WordleGame.dayIndex(today);
    var solution = WordleGame.solutionForDate(today);
    state = newState(dayIndex, solution);

    var saved = Storage.load(dayIndex);
    if (saved) { restore(saved); }

    renderBoard();
    renderKeyboard();

    /* if the day's game is already finished, show stats (without recording) */
    if (state.status !== "playing") {
      window.setTimeout(function () { showStats(WordleStats.load(), -1); }, 600);
    }

    if (document.addEventListener) {
      document.addEventListener("keydown", onKeyDown, false);
    } else if (document.attachEvent) {
      document.attachEvent("onkeydown", onKeyDown);
    }
  }

  return {
    mount: mount,
    setDarkMode: setDarkMode,
    isDarkMode: isDarkMode,
    toggleDarkMode: toggleDarkMode
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = WordleUI;
}
