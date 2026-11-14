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
    rng.weighted = (items, weightOf) => {
      const total = items.reduce((n, it) => n + weightOf(it), 0);
      let roll = rng() * total;
      for (const it of items) { roll -= weightOf(it); if (roll < 0) return it; }
      return items[items.length - 1];
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

  // Every dictionary word matching a pattern where '?' is any letter.
  function* matches(pattern) {
    const i = pattern.indexOf('?');
    if (i < 0) { if (dictionary().has(pattern)) yield pattern; return; }
    for (const c of ALPHABET) yield* matches(pattern.slice(0, i) + c + pattern.slice(i + 1));
  }
  function resolveWord(pattern) {
    for (const w of matches(pattern)) return w;
    return null;
  }
  const reverse = s => [...s].reverse().join('');

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
    return len <= 3 ? 1 : len - 2;
  }

  // ---------- Charms ----------
  // Charms trigger left to right, so order matters: "+mult" before "×mult" is worth more.
  //   tile(c, add, i)  runs once per tile, right after that tile scores its chips.
  //   word(c, add)     runs once per word, after every tile.
  //   onPlay(c)        runs after a word is actually played (for charms that grow).
  //   rules(r)         changes the rules of the game (rack size, words per round...).
  //   roundEnd(run)    returns bonus money at the end of a round.
  // add({chips, mult, xmult, money}) records one scoring step; the UI animates each step.
  const RARITY = {
    common:   { weight: 60, label: 'Common' },
    uncommon: { weight: 30, label: 'Uncommon' },
    rare:     { weight: 10, label: 'Rare' },
  };

  const CHARMS = [
    // --- Common: simple, reliable bonuses ---
    { id: 'openvowel', name: 'Open Vowel', rarity: 'common', price: 4,
      desc: '+4 mult if the word starts with a vowel.',
      word: (c, add) => { if (c.isVowel(c.word[0])) add({ mult: 4 }); } },
    { id: 'repeater', name: 'Repeater', rarity: 'common', price: 4,
      desc: '+4 chips for each letter that appears more than once in the word.',
      tile: (c, add, i) => { if (c.counts[c.letters[i]] > 1) add({ chips: 4 }); } },
    { id: 'vowelsong', name: 'Vowel Song', rarity: 'common', price: 4,
      desc: '+3 chips for each vowel.',
      tile: (c, add, i) => { if (c.isVowel(c.letters[i])) add({ chips: 3 }); } },
    { id: 'hardstop', name: 'Hard Stops', rarity: 'common', price: 4,
      desc: '+4 chips for each B, D, G, K, P or T.',
      tile: (c, add, i) => { if ('BDGKPT'.includes(c.letters[i])) add({ chips: 4 }); } },
    { id: 'heavyink', name: 'Heavy Ink', rarity: 'common', price: 4,
      desc: '+12 chips for each J, K, Q, X or Z.',
      tile: (c, add, i) => { if ('JKQXZ'.includes(c.letters[i])) add({ chips: 12 }); } },
    { id: 'sibilant', name: 'Sibilant', rarity: 'common', price: 4,
      desc: '+2 mult for each S.',
      tile: (c, add, i) => { if (c.letters[i] === 'S') add({ mult: 2 }); } },
    { id: 'haunt', name: 'Haunting', rarity: 'common', price: 4,
      desc: '+3 mult for each H.',
      tile: (c, add, i) => { if (c.letters[i] === 'H') add({ mult: 3 }); } },
    { id: 'bookend', name: 'Bookends', rarity: 'common', price: 4,
      desc: '+20 chips if the word starts and ends with the same letter.',
      word: (c, add) => { if (c.word[0] === c.word[c.word.length - 1]) add({ chips: 20 }); } },
    { id: 'wistful', name: 'Wistful', rarity: 'common', price: 4,
      desc: '+8 mult if the word ends in Y.',
      word: (c, add) => { if (c.word.endsWith('Y')) add({ mult: 8 }); } },
    { id: 'plural', name: 'Plural Pride', rarity: 'common', price: 4,
      desc: '+5 mult if the word ends in S.',
      word: (c, add) => { if (c.word.endsWith('S')) add({ mult: 5 }); } },
    { id: 'crescendo', name: 'Crescendo', rarity: 'common', price: 4,
      desc: '+3 mult for each word already played this round.',
      word: (c, add) => { const n = c.round.played.length; if (n) add({ mult: 3 * n }); } },
    { id: 'thrift', name: 'Thrift', rarity: 'common', price: 4,
      desc: 'Earn $1 per unused swap at the end of each round.',
      roundEnd: run => run.round.swapsLeft },

    // --- Uncommon: conditional multipliers and synergies ---
    { id: 'longshadow', name: 'Long Shadow', rarity: 'uncommon', price: 6,
      desc: '+6 mult for words of 7+ letters.',
      word: (c, add) => { if (c.word.length >= 7) add({ mult: 6 }); } },
    { id: 'starved', name: 'Vowel Starved', rarity: 'uncommon', price: 6,
      desc: '×2 mult if the word has exactly one vowel.',
      word: (c, add) => { if ([...c.word].filter(c.isVowel).length === 1) add({ xmult: 2 }); } },
    { id: 'doublevision', name: 'Double Vision', rarity: 'uncommon', price: 6,
      desc: '×2 mult if the word has a doubled letter (LL, EE…).',
      word: (c, add) => { if (/(.)\1/.test(c.word)) add({ xmult: 2 }); } },
    { id: 'cluster', name: 'Consonant Cluster', rarity: 'uncommon', price: 6,
      desc: '+4 mult for each run of 3+ consonants.',
      word: (c, add) => {
        const runs = c.word.replace(/./g, ch => c.isVowel(ch) ? '.' : '#').match(/#{3,}/g);
        if (runs) add({ mult: 4 * runs.length });
      } },
    { id: 'short', name: 'Short & Sweet', rarity: 'uncommon', price: 6,
      desc: '×3 mult for words of exactly 4 letters.',
      word: (c, add) => { if (c.word.length === 4) add({ xmult: 3 }); } },
    { id: 'alpha', name: 'Alphabetical', rarity: 'uncommon', price: 6,
      desc: '×3 mult if the letters are in alphabetical order (e.g. BEFIT).',
      word: (c, add) => { if ([...c.word].sort().join('') === c.word) add({ xmult: 3 }); } },
    { id: 'mirror', name: 'Mirror', rarity: 'uncommon', price: 5,
      desc: '×5 mult for palindromes (e.g. LEVEL).',
      word: (c, add) => { if (c.word === reverse(c.word)) add({ xmult: 5 }); } },
    { id: 'scribe', name: 'Scribe', rarity: 'uncommon', price: 6,
      desc: 'Gains +2 mult for the rest of the run each time you play a 6+ letter word.',
      word: (c, add) => {
        const total = (c.st.scribe || 0) + (c.word.length >= 6 ? 2 : 0);
        if (total) add({ mult: total });
      },
      onPlay: c => { if (c.word.length >= 6) c.st.scribe = (c.st.scribe || 0) + 2; },
      counter: st => st.scribe ? `+${st.scribe}` : null },
    { id: 'firstdraft', name: 'First Draft', rarity: 'uncommon', price: 6,
      desc: '×2 mult on the first word of each round.',
      word: (c, add) => { if (c.round.played.length === 0) add({ xmult: 2 }); } },
    { id: 'lastword', name: 'Last Word', rarity: 'uncommon', price: 6,
      desc: '×3 mult on the last word of each round.',
      word: (c, add) => { if (c.round.wordsLeft === 1) add({ xmult: 3 }); } },
    { id: 'alliteration', name: 'Alliteration', rarity: 'uncommon', price: 6,
      desc: '×2 mult if the word starts with the same letter as your previous word this round.',
      word: (c, add) => {
        const prev = c.round.played[c.round.played.length - 1];
        if (prev && prev.word[0] === c.word[0]) add({ xmult: 2 });
      } },
    { id: 'hoarder', name: 'Hoarder', rarity: 'uncommon', price: 6,
      desc: '+1 mult for every $3 you hold.',
      word: (c, add) => { const n = Math.floor(c.run.money / 3); if (n) add({ mult: n }); } },
    { id: 'piggy', name: 'Piggy Bank', rarity: 'uncommon', price: 5,
      desc: 'At the end of each round, earn $1 for every $5 you hold (max $5).',
      roundEnd: run => Math.min(5, Math.floor(run.money / 5)) },
    { id: 'goldtouch', name: 'Golden Touch', rarity: 'uncommon', price: 5,
      desc: 'Gold tiles also give +6 mult.',
      tile: (c, add, i) => { if (c.tiles[i].mod === 'gold') add({ mult: 6 }); } },
    { id: 'ghoststory', name: 'Ghost Story', rarity: 'uncommon', price: 5,
      desc: 'Ghost tiles also give ×1.5 mult.',
      tile: (c, add, i) => { if (c.tiles[i].mod === 'ghost') add({ xmult: 1.5 }); } },
    { id: 'fluent', name: 'Fluent', rarity: 'uncommon', price: 5,
      desc: 'Y counts as a vowel for every rule. Y tiles give +6 chips.',
      rules: r => { r.yIsVowel = true; },
      tile: (c, add, i) => { if (c.letters[i] === 'Y') add({ chips: 6 }); } },
    { id: 'recycler', name: 'Recycler', rarity: 'uncommon', price: 5,
      desc: '+2 swaps each round.',
      rules: r => { r.swaps += 2; } },

    // --- Rare: rules that change how the game works ---
    { id: 'bigpockets', name: 'Big Pockets', rarity: 'rare', price: 8,
      desc: 'Your rack holds 3 more tiles.',
      rules: r => { r.rackSize += 3; } },
    { id: 'extradraft', name: 'Extra Draft', rarity: 'rare', price: 8,
      desc: '+1 word each round.',
      rules: r => { r.words += 1; } },
    { id: 'backwards', name: 'Mirror Writing', rarity: 'rare', price: 7,
      desc: 'You may spell words backwards. Backwards words get ×2 mult.',
      rules: r => { r.reverse = true; },
      word: (c, add) => { if (c.reversed) add({ xmult: 2 }); } },
    { id: 'copycat', name: 'Copycat', rarity: 'rare', price: 8,
      desc: 'Copies the scoring of the charm to its right.',
      copies: true },
    { id: 'minimalist', name: 'Minimalist', rarity: 'rare', price: 7,
      desc: '×1.5 mult for each empty charm slot.',
      word: (c, add) => {
        const empty = MAX_CHARMS - c.run.charms.length;
        if (empty) add({ xmult: Math.pow(1.5, empty) });
      } },
  ];
  const CHARM_BY_ID = Object.fromEntries(CHARMS.map(c => [c.id, c]));
  const MAX_CHARMS = 5;

  // ---------- Curses (boss rounds) ----------
  const CURSES = [
    { id: 'silente', name: 'The Silent E', desc: 'E tiles score 0 chips.' },
    { id: 'block', name: "Writer's Block", desc: 'Words must be 5+ letters.',
      rules: r => { r.minLength = Math.max(r.minLength, 5); } },
    { id: 'shortage', name: 'Ink Shortage', desc: 'One fewer word this round.',
      rules: r => { r.words -= 1; } },
    { id: 'nostart', name: 'Fading Vowels', desc: 'Words may not start with a vowel.',
      check: (w, run) => isVowel(run, w[0]) ? 'Words may not start with a vowel this round.' : null },
    { id: 'lost', name: 'Lost Letter', desc: 'One common letter can\'t be used.',
      setup: (curse, rng) => {
        curse.letter = rng.pick([...'RSTLND']);
        curse.desc = `The letter ${curse.letter} can't be used this round.`;
      },
      check: (w, run, curse) => w.includes(curse.letter) ? `${curse.letter} is banned this round.` : null },
    { id: 'muted', name: 'Muffled', desc: 'Your leftmost charm does nothing this round.' },
    { id: 'tight', name: 'Tight Rack', desc: 'Your rack holds 3 fewer tiles.',
      rules: r => { r.rackSize -= 3; } },
    { id: 'tax', name: 'Ink Tax', desc: 'Each word you play costs $1.' },
  ];

  // ---------- Run / round setup ----------
  const TARGETS = [60, 120, 200, 320, 480, 700, 1000, 1400];
  const BOSS_ROUNDS = [2, 5, 7]; // zero-based: rounds 3, 6, 8

  function rules(run) {
    const r = { rackSize: 12, words: 4, swaps: 3, minLength: 3, reverse: false, yIsVowel: false };
    run.charms.forEach((id, k) => {
      const ch = CHARM_BY_ID[id];
      if (ch.rules && isActive(run, k)) ch.rules(r);
    });
    const curse = run.curseByRound[run.roundIndex];
    if (curse && curse.rules) curse.rules(r);
    return r;
  }

  function isVowel(run, ch) {
    return 'AEIOU'.includes(ch) || (ch === 'Y' && rules(run).yIsVowel);
  }

  // A charm is inactive when the Muffled curse silences the leftmost slot.
  function isActive(run, k) {
    const curse = run.curseByRound[run.roundIndex];
    return !(curse && curse.id === 'muted' && k === 0);
  }

  // The charm whose hooks slot k uses (Copycat borrows its right neighbour's).
  function effectiveCharm(run, k) {
    const ch = CHARM_BY_ID[run.charms[k]];
    if (!ch.copies) return ch;
    const next = CHARM_BY_ID[run.charms[k + 1]];
    return next && !next.copies ? next : null;
  }

  function newRun(seed) {
    seed = (seed == null ? Math.floor(Math.random() * 1e9) : seed) >>> 0;
    const rng = makeRng(seed);
    const deck = [];
    for (const [letter, n] of Object.entries(STARTING_COUNTS)) {
      for (let i = 0; i < n; i++) deck.push(makeTile(letter));
    }
    const curseByRound = {};
    rng.shuffle(CURSES.slice()).slice(0, BOSS_ROUNDS.length).forEach((proto, i) => {
      const curse = Object.assign({}, proto);
      if (curse.setup) curse.setup(curse, rng);
      curseByRound[BOSS_ROUNDS[i]] = curse;
    });
    const run = {
      seed, rng, deck,
      money: 4,
      charms: [],
      charmState: {},
      roundIndex: 0,
      curseByRound,
      phase: 'play', // play | shop | won | lost
      bestWord: null,
      wordsPlayed: 0,
      round: null,
      shop: null,
    };
    startRound(run);
    return run;
  }

  function startRound(run) {
    const r = rules(run);
    const round = {
      target: TARGETS[run.roundIndex],
      score: 0,
      wordsLeft: r.words,
      swapsLeft: r.swaps,
      curse: run.curseByRound[run.roundIndex] || null,
      bag: run.rng.shuffle(run.deck.slice()),
      rack: [],
      played: [],
      usedWords: new Set(),
    };
    run.round = round;
    run.phase = 'play';
    refill(run);
  }

  function refill(run) {
    const round = run.round, size = rules(run).rackSize;
    while (round.rack.length < size && round.bag.length) round.rack.push(round.bag.pop());
  }

  // ---------- Scoring ----------
  function tileChips(tile, letter, curse) {
    if (tile.mod === 'wild') return 0;
    if (curse && curse.id === 'silente' && letter === 'E') return 0;
    const v = LETTER_VALUES[letter] || 0;
    return tile.mod === 'double' ? v * 2 : v;
  }

  // Find the reading of the tiles to score: wilds resolved, maybe backwards.
  function readTiles(run, tiles) {
    const round = run.round, R = rules(run);
    const pattern = tiles.map(t => t.letter).join('');
    let firstError = null;
    const tryRead = (spelled, word, reversed) => {
      if (round.usedWords.has(word)) { firstError = firstError || `You already played ${word} this round.`; return null; }
      const curse = round.curse;
      const err = curse && curse.check && curse.check(word, run, curse);
      if (err) { firstError = firstError || err; return null; }
      return { letters: [...spelled], word, reversed };
    };
    for (const w of matches(pattern)) {
      const r = tryRead(w, w, false);
      if (r) return r;
    }
    if (R.reverse) {
      for (const w of matches(reverse(pattern))) {
        const r = tryRead(reverse(w), w, true);
        if (r) return r;
      }
    }
    return { error: firstError || `${pattern.replace(/\?/g, '·')} isn't in the dictionary.` };
  }

  // Validate and score tiles. Returns {ok:false, error} or
  // {ok:true, word, chips, mult, total, events}. Each event is one scoring step:
  // {tile?, charm?, chips?, mult?, xmult?, chipsNow, multNow} for the UI to animate.
  function evaluate(run, tiles) {
    const round = run.round, R = rules(run);
    if (tiles.length < R.minLength) return { ok: false, error: `Words need at least ${R.minLength} letters.` };
    const read = readTiles(run, tiles);
    if (read.error) return { ok: false, error: read.error };
    const { word, letters, reversed } = read;

    const counts = {};
    for (const ch of word) counts[ch] = (counts[ch] || 0) + 1;
    const c = {
      run, round, tiles, word, letters, reversed, counts, st: run.charmState,
      isVowel: ch => isVowel(run, ch),
    };

    const s = { chips: 0, mult: lengthMult(word.length) };
    const events = [{ base: true, mult: s.mult, chipsNow: 0, multNow: s.mult }];
    const add = src => d => {
      if (d.chips) s.chips += d.chips;
      if (d.mult) s.mult += d.mult;
      if (d.xmult) s.mult *= d.xmult;
      s.mult = Math.round(s.mult * 100) / 100;
      events.push(Object.assign({}, src, d, { chipsNow: s.chips, multNow: s.mult }));
    };

    const active = [];
    run.charms.forEach((id, k) => {
      const ch = isActive(run, k) && effectiveCharm(run, k);
      if (ch) active.push({ k, ch });
    });

    tiles.forEach((t, i) => {
      add({ tile: i })({ chips: tileChips(t, letters[i], round.curse) });
      if (t.mod === 'ghost') add({ tile: i })({ mult: 3 });
      for (const { k, ch } of active) if (ch.tile) ch.tile(c, add({ tile: i, charm: k }), i);
    });
    for (const { k, ch } of active) if (ch.word) ch.word(c, add({ charm: k }));

    const total = Math.floor(s.chips * s.mult);
    return { ok: true, word, reversed, chips: s.chips, mult: s.mult, total, events, ctx: c, active };
  }

  function tilesFromIds(round, ids) {
    return ids.map(id => round.rack.find(t => t.id === id)).filter(Boolean);
  }

  function playWord(run, ids) {
    const round = run.round;
    if (run.phase !== 'play' || round.wordsLeft <= 0) return { ok: false, error: 'No words left.' };
    const tiles = tilesFromIds(round, ids);
    const res = evaluate(run, tiles);
    if (!res.ok) return res;

    for (const { ch } of res.active) if (ch.onPlay) ch.onPlay(res.ctx);
    delete res.ctx; delete res.active;

    round.score += res.total;
    round.wordsLeft--;
    round.usedWords.add(res.word);
    round.played.push({ word: res.word, total: res.total });
    run.wordsPlayed++;
    if (!run.bestWord || res.total > run.bestWord.total) run.bestWord = { word: res.word, total: res.total };

    let money = tiles.filter(t => t.mod === 'gold').length;
    if (round.curse && round.curse.id === 'tax') money -= 1;
    run.money = Math.max(0, run.money + money);
    res.money = money;

    for (const t of tiles) if (t.mod !== 'echo') round.rack = round.rack.filter(r => r !== t);
    refill(run);

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
    refill(run);
    // Swapped tiles go back into the bag at random positions.
    for (const t of tiles) round.bag.splice(run.rng.int(round.bag.length + 1), 0, t);
    round.swapsLeft--;
    return { ok: true };
  }

  function finishRound(run, lastResult) {
    const round = run.round;
    const breakdown = [{ label: 'Round cleared', money: 4 }];
    if (round.wordsLeft) breakdown.push({ label: `${round.wordsLeft} unused word${round.wordsLeft > 1 ? 's' : ''}`, money: round.wordsLeft });
    run.charms.forEach((id, k) => {
      const ch = CHARM_BY_ID[id];
      const m = ch.roundEnd && isActive(run, k) ? ch.roundEnd(run) : 0;
      if (m) breakdown.push({ label: ch.name, money: m });
    });
    const earned = breakdown.reduce((n, b) => n + b.money, 0);
    run.money += earned;
    round.earned = earned;
    round.breakdown = breakdown;
    if (lastResult) lastResult.roundCleared = true;
    if (run.roundIndex === TARGETS.length - 1) { run.phase = 'won'; return; }
    run.phase = 'shop';
    run.shop = makeShop(run);
  }

  // ---------- Charm management ----------
  function moveCharm(run, from, to) {
    if (to < 0 || to >= run.charms.length) return false;
    const [id] = run.charms.splice(from, 1);
    run.charms.splice(to, 0, id);
    return true;
  }

  function sellValue(id) { return Math.floor(CHARM_BY_ID[id].price / 2); }

  function sellCharm(run, id) {
    const i = run.charms.indexOf(id);
    if (i < 0) return { ok: false };
    run.charms.splice(i, 1);
    run.money += sellValue(id);
    return { ok: true };
  }

  // ---------- Shop ----------
  const INK_PRICES = { double: 3, gold: 3, echo: 5, ghost: 5, wild: 6 };

  function makeShop(run) {
    const pool = CHARMS.filter(c => !run.charms.includes(c.id));
    const charms = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const pick = run.rng.weighted(pool, c => RARITY[c.rarity].weight);
      pool.splice(pool.indexOf(pick), 1);
      charms.push({ kind: 'charm', id: pick.id, price: pick.price });
    }
    const inks = [];
    for (let i = 0; i < 2; i++) {
      const mod = run.rng.pick(Object.keys(INK_PRICES));
      const plain = run.deck.filter(t => !t.mod);
      if (!plain.length) break;
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
      if (run.charms.length >= MAX_CHARMS) return { ok: false, error: `You can hold ${MAX_CHARMS} charms. Sell one first.` };
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
    makeRng, resolveWord, dictionary, newRun, evaluate, playWord, swapTiles, rules,
    buy, sellCharm, sellValue, moveCharm, rerollShop, nextRound, lengthMult, isActive,
    LETTER_VALUES, MODS, CHARMS, CHARM_BY_ID, CURSES, RARITY, TARGETS, MAX_CHARMS,
    _test: { makeTile, finishRound },
  };
})(typeof window !== 'undefined' ? window : globalThis);
