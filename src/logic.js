// Ghostwriter: core game rules. No DOM access here, so it runs in Node tests too.
(function (root) {
  'use strict';

  // ---------- Randomness (seeded so runs are reproducible) ----------
  function makeRng(seed) {
    let a = seed >>> 0;
    const rng = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.int = n => Math.floor(rng() * n);
    rng.pick = arr => arr[rng.int(arr.length)];
    rng.shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    return rng;
  }

  // ---------- Dictionary ----------
  let DICT = null;
  function dictionary() {
    if (!DICT) DICT = new Set((root.GW_WORDS || '').split(' '));
    return DICT;
  }
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Resolve a pattern that may contain '?' wildcards to a real word, or null.
  function resolveWord(pattern) {
    const dict = dictionary();
    const i = pattern.indexOf('?');
    if (i < 0) return dict.has(pattern) ? pattern : null;
    for (const c of ALPHABET) {
      const r = resolveWord(pattern.slice(0, i) + c + pattern.slice(i + 1));
      if (r) return r;
    }
    return null;
  }

  // ---------- Letters ----------
  const LETTER_VALUES = {
    A: 1, E: 1, I: 1, O: 1, U: 2,
    N: 2, R: 2, S: 2, T: 2, L: 2, D: 2,
    G: 3, H: 3, C: 3, M: 3, P: 3, B: 3,
    F: 4, W: 4, Y: 4, V: 5, K: 5,
    J: 8, X: 8, Q: 10, Z: 10,
  };
  // How many of each letter the starting deck holds (58 tiles).
  const STARTING_COUNTS = {
    E: 6, A: 5, I: 4, O: 4, U: 2,
    T: 3, N: 3, R: 3, S: 3, L: 2, D: 2,
    H: 2, C: 2, M: 2, P: 2, G: 1, B: 1,
    F: 1, W: 1, Y: 1, V: 1, K: 1, J: 1, X: 1, Q: 1, Z: 1,
  };
  const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

  const MODS = {
    double: { name: 'Double', desc: 'Scores twice its letter value.' },
    gold:   { name: 'Gold',   desc: 'Earns $1 when played.' },
    wild:   { name: 'Wild',   desc: 'Stands in for any letter. Scores 0.' },
    echo:   { name: 'Echo',   desc: 'Returns to your rack after being played.' },
    ghost:  { name: 'Ghost',  desc: '+3 mult when played.' },
  };

  let nextTileId = 1;
  function makeTile(letter, mod) {
    return { id: nextTileId++, letter: mod === 'wild' ? '?' : letter, mod: mod || null };
  }

  function lengthMult(len) {
    if (len <= 3) return 1;
    return len - 2;
  }

  // ---------- Charms (passive upgrades) ----------
  // score(ctx, s): mutate s.chips / s.mult / s.xmult. ctx has word, tiles, run.
  const CHARMS = [
    { id: 'longshadow', name: 'Long Shadow', price: 5,
      desc: '+4 mult for words of 7+ letters.',
      score: (c, s) => { if (c.word.length >= 7) s.mult += 4; } },
    { id: 'starved', name: 'Vowel Starved', price: 6,
      desc: '+6 mult if the word has exactly one vowel.',
      score: (c, s) => { if (countVowels(c.word) === 1) s.mult += 6; } },
    { id: 'mirror', name: 'Mirror', price: 4,
      desc: '×3 for palindromes.',
      score: (c, s) => { if (c.word === [...c.word].reverse().join('')) s.xmult *= 3; } },
    { id: 'bookend', name: 'Bookends', price: 4,
      desc: '+15 chips if the word starts and ends with the same letter.',
      score: (c, s) => { if (c.word[0] === c.word[c.word.length - 1]) s.chips += 15; } },
    { id: 'heavyink', name: 'Heavy Ink', price: 5,
      desc: 'J, K, Q, X and Z give +10 chips each.',
      score: (c, s) => { for (const ch of c.word) if ('JKQXZ'.includes(ch)) s.chips += 10; } },
    { id: 'haunt', name: 'Haunting', price: 4,
      desc: '+2 mult for each H.',
      score: (c, s) => { for (const ch of c.word) if (ch === 'H') s.mult += 2; } },
    { id: 'alpha', name: 'Alphabetical', price: 6,
      desc: '×2 if the letters are in alphabetical order (e.g. BEFIT).',
      score: (c, s) => { if ([...c.word].sort().join('') === c.word) s.xmult *= 2; } },
    { id: 'doublevision', name: 'Double Vision', price: 5,
      desc: '×1.5 if the word has a doubled letter (LL, EE…).',
      score: (c, s) => { if (/(.)\1/.test(c.word)) s.xmult *= 1.5; } },
    { id: 'cluster', name: 'Consonant Cluster', price: 5,
      desc: '+3 mult for each run of 3+ consonants.',
      score: (c, s) => { s.mult += 3 * (c.word.match(/[^AEIOU]{3,}/g) || []).length; } },
    { id: 'short', name: 'Short & Sweet', price: 5,
      desc: '×2 for words of exactly 4 letters.',
      score: (c, s) => { if (c.word.length === 4) s.xmult *= 2; } },
    { id: 'sibilant', name: 'Sibilant', price: 3,
      desc: '+1 mult for each S.',
      score: (c, s) => { for (const ch of c.word) if (ch === 'S') s.mult += 1; } },
    { id: 'scribe', name: 'Scribe', price: 7,
      desc: 'Gains +1 mult for the rest of the run each time you play a 6+ letter word.',
      score: (c, s) => {
        const st = c.run.charmState;
        if (c.word.length >= 6 && !c.preview) st.scribe = (st.scribe || 0) + 1;
        s.mult += (st.scribe || 0) + (c.word.length >= 6 && c.preview ? 1 : 0);
      } },
    { id: 'thrift', name: 'Thrift', price: 4,
      desc: 'Earn $1 per unused swap at the end of each round.',
      roundEnd: (run, round) => round.swapsLeft },
  ];
  const CHARM_BY_ID = Object.fromEntries(CHARMS.map(c => [c.id, c]));
  const MAX_CHARMS = 5;

  function countVowels(word) {
    let n = 0;
    for (const ch of word) if (VOWELS.has(ch)) n++;
    return n;
  }

  // ---------- Curses (boss rounds) ----------
  const CURSES = [
    { id: 'silente', name: 'The Silent E', desc: 'E tiles score 0 chips.' },
    { id: 'block', name: "Writer's Block", desc: 'Words must be 5+ letters.',
      check: w => w.length >= 5 ? null : 'Words must be 5+ letters this round.' },
    { id: 'shortage', name: 'Ink Shortage', desc: 'Only 3 words this round.' },
    { id: 'nostart', name: 'Fading Vowels', desc: 'Words may not start with a vowel.',
      check: w => VOWELS.has(w[0]) ? 'Words may not start with a vowel this round.' : null },
  ];

  // ---------- Run / round setup ----------
  const TARGETS = [60, 110, 180, 260, 380, 540, 760, 1050];
  const BOSS_ROUNDS = new Set([2, 5, 7]); // zero-based: rounds 3, 6, 8
  const RACK_SIZE = 12;
  const WORDS_PER_ROUND = 4;
  const SWAPS_PER_ROUND = 3;

  function newRun(seed) {
    seed = (seed == null ? Math.floor(Math.random() * 1e9) : seed) >>> 0;
    const rng = makeRng(seed);
    const deck = [];
    for (const [letter, n] of Object.entries(STARTING_COUNTS)) {
      for (let i = 0; i < n; i++) deck.push(makeTile(letter));
    }
    const curses = rng.shuffle(CURSES.slice());
    const run = {
      seed, rng, deck,
      money: 4,
      charms: [],
      charmState: {},
      roundIndex: 0,
      curseByRound: { 2: curses[0], 5: curses[1], 7: curses[2] },
      phase: 'play', // play | shop | won | lost
      bestWord: null,
      round: null,
      shop: null,
    };
    startRound(run);
    return run;
  }

  function startRound(run) {
    const curse = run.curseByRound[run.roundIndex] || null;
    const round = {
      target: TARGETS[run.roundIndex],
      score: 0,
      wordsLeft: curse && curse.id === 'shortage' ? 3 : WORDS_PER_ROUND,
      swapsLeft: SWAPS_PER_ROUND,
      curse,
      bag: run.rng.shuffle(run.deck.slice()),
      rack: [],
      played: [],
      usedWords: new Set(),
    };
    run.round = round;
    run.phase = 'play';
    refill(round);
  }

  function refill(round) {
    while (round.rack.length < RACK_SIZE && round.bag.length) round.rack.push(round.bag.pop());
  }

  // ---------- Scoring ----------
  function tileChips(tile, letter, curse) {
    if (tile.mod === 'wild') return 0;
    if (curse && curse.id === 'silente' && letter === 'E') return 0;
    const v = LETTER_VALUES[letter] || 0;
    return tile.mod === 'double' ? v * 2 : v;
  }

  // Validate and score a sequence of tiles. Returns {ok, error} or {ok, word, ...breakdown}.
  function evaluate(run, tiles, preview) {
    const round = run.round;
    if (tiles.length < 3) return { ok: false, error: 'Words need at least 3 letters.' };
    const pattern = tiles.map(t => t.letter).join('');
    const word = resolveWord(pattern);
    if (!word) return { ok: false, error: `${pattern.replace(/\?/g, '·')} isn't in the dictionary.` };
    if (round.usedWords.has(word)) return { ok: false, error: `You already played ${word} this round.` };
    if (round.curse && round.curse.check) {
      const err = round.curse.check(word);
      if (err) return { ok: false, error: err };
    }

    const s = { chips: 0, mult: lengthMult(word.length), xmult: 1 };
    tiles.forEach((t, i) => {
      s.chips += tileChips(t, word[i], round.curse);
      if (t.mod === 'ghost') s.mult += 3;
    });
    const ctx = { word, tiles, run, preview: !!preview };
    for (const id of run.charms) {
      const ch = CHARM_BY_ID[id];
      if (ch.score) ch.score(ctx, s);
    }
    const total = Math.floor(s.chips * s.mult * s.xmult);
    return { ok: true, word, chips: s.chips, mult: s.mult, xmult: s.xmult, total };
  }

  function tilesFromIds(round, ids) {
    return ids.map(id => round.rack.find(t => t.id === id)).filter(Boolean);
  }

  function playWord(run, ids) {
    const round = run.round;
    if (run.phase !== 'play' || round.wordsLeft <= 0) return { ok: false, error: 'No words left.' };
    const tiles = tilesFromIds(round, ids);
    const res = evaluate(run, tiles, false);
    if (!res.ok) return res;

    round.score += res.total;
    round.wordsLeft--;
    round.usedWords.add(res.word);
    round.played.push({ word: res.word, total: res.total });
    if (!run.bestWord || res.total > run.bestWord.total) run.bestWord = { word: res.word, total: res.total };

    let gold = 0;
    for (const t of tiles) {
      if (t.mod === 'gold') gold++;
      if (t.mod !== 'echo') round.rack = round.rack.filter(r => r !== t);
    }
    run.money += gold;
    res.gold = gold;
    refill(round);

    if (round.score >= round.target) finishRound(run, res);
    else if (round.wordsLeft === 0) run.phase = 'lost';
    return res;
  }

  function swapTiles(run, ids) {
    const round = run.round;
    if (run.phase !== 'play') return { ok: false, error: 'Not now.' };
    if (round.swapsLeft <= 0) return { ok: false, error: 'No swaps left.' };
    if (!ids.length) return { ok: false, error: 'Select tiles to swap first.' };
    if (!round.bag.length) return { ok: false, error: 'The bag is empty.' };
    const tiles = tilesFromIds(round, ids);
    round.rack = round.rack.filter(t => !tiles.includes(t));
    refill(round);
    // Swapped tiles go back into the bag at random positions.
    for (const t of tiles) round.bag.splice(run.rng.int(round.bag.length + 1), 0, t);
    round.swapsLeft--;
    return { ok: true };
  }

  function finishRound(run, lastResult) {
    const round = run.round;
    let earned = 4 + round.wordsLeft;
    for (const id of run.charms) {
      const ch = CHARM_BY_ID[id];
      if (ch.roundEnd) earned += ch.roundEnd(run, round);
    }
    run.money += earned;
    round.earned = earned;
    if (lastResult) lastResult.roundCleared = true;
    if (run.roundIndex === TARGETS.length - 1) { run.phase = 'won'; return; }
    run.phase = 'shop';
    run.shop = makeShop(run);
  }

  // ---------- Shop ----------
  const INK_PRICES = { double: 3, gold: 3, echo: 5, ghost: 5, wild: 6 };

  function makeShop(run) {
    const available = CHARMS.filter(c => !run.charms.includes(c.id));
    const charms = run.rng.shuffle(available.slice()).slice(0, 3).map(c => ({ kind: 'charm', id: c.id, price: c.price }));
    const inks = [];
    const modKeys = Object.keys(INK_PRICES);
    for (let i = 0; i < 2; i++) {
      const mod = run.rng.pick(modKeys);
      const plain = run.deck.filter(t => !t.mod);
      const letter = mod === 'wild' ? null : run.rng.pick(plain).letter;
      inks.push({ kind: 'ink', mod, letter, price: INK_PRICES[mod] });
    }
    return { items: charms.concat(inks), rerollCost: 2 };
  }

  function buy(run, index) {
    const item = run.shop && run.shop.items[index];
    if (!item || item.sold) return { ok: false, error: 'Nothing there.' };
    if (run.money < item.price) return { ok: false, error: 'Not enough money.' };
    if (item.kind === 'charm') {
      if (run.charms.length >= MAX_CHARMS) return { ok: false, error: `You can hold ${MAX_CHARMS} charms.` };
      run.charms.push(item.id);
    } else if (item.mod === 'wild') {
      // A wild tile replaces a random plain tile so the deck size stays the same.
      const plain = run.deck.filter(t => !t.mod);
      const victim = run.rng.pick(plain);
      run.deck[run.deck.indexOf(victim)] = makeTile(null, 'wild');
    } else {
      const target = run.deck.find(t => !t.mod && t.letter === item.letter);
      if (!target) return { ok: false, error: `No plain ${item.letter} tiles left.` };
      target.mod = item.mod;
    }
    run.money -= item.price;
    item.sold = true;
    return { ok: true };
  }

  function sellCharm(run, id) {
    const i = run.charms.indexOf(id);
    if (i < 0) return { ok: false };
    run.charms.splice(i, 1);
    run.money += Math.floor(CHARM_BY_ID[id].price / 2);
    return { ok: true };
  }

  function rerollShop(run) {
    if (run.money < run.shop.rerollCost) return { ok: false, error: 'Not enough money.' };
    run.money -= run.shop.rerollCost;
    const cost = run.shop.rerollCost + 1;
    run.shop = makeShop(run);
    run.shop.rerollCost = cost;
    return { ok: true };
  }

  function nextRound(run) {
    if (run.phase !== 'shop') return;
    run.roundIndex++;
    run.shop = null;
    startRound(run);
  }

  root.GW = {
    makeRng, resolveWord, dictionary, newRun, evaluate, playWord, swapTiles,
    buy, sellCharm, rerollShop, nextRound, lengthMult,
    LETTER_VALUES, MODS, CHARMS, CHARM_BY_ID, CURSES, TARGETS, MAX_CHARMS, RACK_SIZE,
    _test: { makeTile, finishRound },
  };
})(typeof window !== 'undefined' ? window : globalThis);
