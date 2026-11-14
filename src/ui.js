// Ghostwriter: rendering, input, animation and sound cues. All rules live in logic.js (window.GW).
(function () {
  'use strict';
  const GW = window.GW;
  const Sound = window.Sound;
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  let run = null;
  let selected = [];       // tile ids, in spelling order
  let rackOrder = [];      // tile ids, display order (shuffle only changes this)
  let fresh = new Set();   // tile ids that should animate in on the next render
  let focusedCharm = null; // index of the charm showing its move/sell buttons
  let justAdded = null;    // tile id that just joined the word (only it animates in)
  let busy = false;        // true while a word is being scored
  let fast = false;        // player asked to skip ahead during scoring

  // ---------- DOM helpers ----------
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c);
    return e;
  }

  function retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // restart the CSS animation
    node.classList.add(cls);
  }

  const fmt = n => String(Math.round(n * 100) / 100);

  function setNum(id, value) {
    const node = $(id);
    node.textContent = fmt(value);
    retrigger(node, 'punch');
  }

  function floatText(anchor, text, cls) {
    const r = anchor.getBoundingClientRect();
    const f = el('div', { class: `float ${cls}`, style: `left:${r.left + r.width / 2}px; top:${r.top + 6}px` }, text);
    $('fx').append(f);
    setTimeout(() => f.remove(), 900);
  }

  function burst(anchor, count) {
    const r = anchor.getBoundingClientRect();
    const colors = ['#f3ead7', '#9d7bff', '#6fd6c4', '#f2c14e', '#ff5d6c', '#5aa9ff'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 220;
      const p = el('div', {
        class: 'particle',
        style: `left:${r.left + Math.random() * r.width}px; top:${r.top + r.height / 2}px; background:${colors[i % colors.length]};` +
          `--dx:${Math.cos(angle) * dist}px; --dy:${Math.sin(angle) * dist - 60}px; --rot:${Math.random() * 720 - 360}deg;`,
      });
      $('fx').append(p);
      setTimeout(() => p.remove(), 1200);
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    retrigger(t, 'toast');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- Tiles ----------
  function tileValue(tile) {
    if (tile.mod === 'wild') return 0;
    return (GW.LETTER_VALUES[tile.letter] || 0) * (tile.mod === 'double' ? 2 : 1);
  }

  function tileEl(tile, opts) {
    const value = tileValue(tile);
    const title = tile.mod ? `${GW.MODS[tile.mod].name}: ${GW.MODS[tile.mod].desc}` : `${tile.letter}: ${value} chips`;
    return el('button', {
      class: `tile${tile.mod ? ' mod-' + tile.mod : ''}${opts.used ? ' used' : ''}${opts.fresh ? ' fresh' : ''}${opts.added ? ' added' : ''}`,
      style: opts.delay != null ? `animation-delay:${opts.delay}ms` : null,
      title, 'aria-label': `${tile.letter === '?' ? 'wild' : tile.letter}${tile.mod ? ' ' + tile.mod : ''}`,
      onclick: opts.onclick,
    },
    tile.letter,
    el('span', { class: 'val' }, String(value)),
    tile.mod && tile.mod !== 'wild' ? el('span', { class: 'mod' }, GW.MODS[tile.mod].name) : null);
  }

  function syncRackOrder() {
    const ids = run.round.rack.map(t => t.id);
    rackOrder = rackOrder.filter(id => ids.includes(id));
    for (const id of ids) if (!rackOrder.includes(id)) rackOrder.push(id);
    selected = selected.filter(id => ids.includes(id));
  }

  const selectedTiles = () => selected.map(id => run.round.rack.find(t => t.id === id));

  // ---------- Rendering ----------
  function render() {
    const r = run.round;
    syncRackOrder();
    $('round').textContent = `${run.roundIndex + 1} / ${GW.TARGETS.length}`;
    $('words').textContent = r.wordsLeft;
    $('swaps').textContent = r.swapsLeft;
    $('money').textContent = `$${run.money}`;
    $('score').textContent = r.score;
    $('target').textContent = r.target;
    $('bar-fill').style.width = `${Math.min(100, (r.score / r.target) * 100)}%`;
    $('seed').textContent = `Seed ${run.seed}`;
    $('bag').textContent = `${r.bag.length} tiles in the bag`;
    $('btn-mute').textContent = Sound.muted ? '🔇' : '🔊';

    const curse = $('curse');
    curse.hidden = !r.curse;
    if (r.curse) curse.replaceChildren(el('strong', {}, `Cursed: ${r.curse.name}. `), r.curse.desc);

    const byId = new Map(r.rack.map(t => [t.id, t]));
    $('word').replaceChildren(...selected.map(id => tileEl(byId.get(id), { added: id === justAdded, onclick: () => unselect(id) })));
    justAdded = null;
    let n = 0;
    $('rack').replaceChildren(...rackOrder.map(id => {
      const isFresh = fresh.has(id);
      return tileEl(byId.get(id), {
        used: selected.includes(id), fresh: isFresh, delay: isFresh ? 40 * n++ : null,
        onclick: () => select(id),
      });
    }));
    fresh.clear();

    const preview = renderPreview();
    renderCharms(preview && preview.ok ? new Set(preview.events.map(e => e.charm).filter(k => k != null)) : new Set());
    $('played').replaceChildren(...r.played.map(p => el('li', {}, p.word, el('b', {}, `+${p.total}`))));

    const playing = run.phase === 'play' && !busy;
    $('btn-play').disabled = !playing || selected.length < 3;
    $('btn-swap').disabled = !playing || !selected.length || r.swapsLeft <= 0;
    $('btn-shuffle').disabled = !playing;
    $('btn-clear').disabled = !playing || !selected.length;
  }

  function renderCharms(ready) {
    const box = $('charms');
    const cards = run.charms.map((id, k) => {
      const c = GW.CHARM_BY_ID[id];
      const counter = c.counter && c.counter(run.charmState);
      const focused = focusedCharm === k && !busy;
      const cls = ['charm', c.rarity, ready.has(k) ? 'ready' : '', GW.isActive(run, k) ? '' : 'muted', focused ? 'focused' : ''].join(' ');
      return el('div', {
        class: cls, role: 'button', tabindex: '0', title: `${c.name} (${GW.RARITY[c.rarity].label}): ${c.desc}`,
        onclick: () => { if (busy) return; focusedCharm = focusedCharm === k ? null : k; render(); },
      },
      el('span', { class: 'name' }, c.name),
      counter ? el('span', { class: 'counter' }, counter) : null,
      el('span', { class: 'desc' }, c.desc),
      focused ? el('div', { class: 'charm-actions' },
        el('button', { disabled: k === 0, 'aria-label': 'Move left', onclick: e => { e.stopPropagation(); moveCharm(k, -1); } }, '◀'),
        el('button', { class: 'sell', onclick: e => { e.stopPropagation(); sell(k); } }, `Sell $${GW.sellValue(id)}`),
        el('button', { disabled: k === run.charms.length - 1, 'aria-label': 'Move right', onclick: e => { e.stopPropagation(); moveCharm(k, 1); } }, '▶'))
        : null);
    });
    for (let i = run.charms.length; i < GW.MAX_CHARMS; i++) {
      cards.push(el('div', { class: 'charm empty' }, i === 0 ? 'Buy charms between rounds' : 'Empty'));
    }
    box.replaceChildren(...cards);
  }

  // While spelling, show the word's base chips and mult, and light up the charms
  // that will trigger. The charm bonuses themselves are revealed when you play.
  function renderPreview() {
    if (busy) return null;
    const label = $('word-label');
    const word = $('word');
    word.classList.remove('valid', 'invalid');
    $('equals').textContent = '';
    const tiles = selectedTiles();
    const minLen = GW.rules(run).minLength;
    if (tiles.length === 0) {
      label.textContent = 'Click tiles or type to spell a word.';
      $('chips').textContent = '0'; $('mult').textContent = '0';
      return null;
    }
    const baseChips = tiles.reduce((n, t) => n + tileValue(t), 0);
    $('chips').textContent = baseChips;
    $('mult').textContent = GW.lengthMult(tiles.length);
    if (tiles.length < minLen) { label.textContent = `${minLen - tiles.length} more letter${minLen - tiles.length > 1 ? 's' : ''}…`; return null; }
    const res = GW.evaluate(run, tiles);
    if (!res.ok) {
      word.classList.add('invalid');
      label.replaceChildren(el('span', { class: 'err' }, res.error));
      return res;
    }
    word.classList.add('valid');
    const charmsFiring = new Set(res.events.map(e => e.charm).filter(k => k != null)).size;
    label.replaceChildren(el('span', { class: 'ok' }, res.word),
      res.reversed ? ' (backwards)' : '',
      charmsFiring ? ` · ${charmsFiring} charm${charmsFiring > 1 ? 's' : ''} will trigger` : '');
    return res;
  }

  // ---------- Actions ----------
  function select(id) {
    if (run.phase !== 'play' || busy || selected.includes(id)) return;
    selected.push(id);
    justAdded = id;
    Sound.pick(selected.length - 1);
    render();
  }
  function unselect(id) {
    if (busy) return;
    selected = selected.filter(s => s !== id);
    Sound.drop();
    render();
  }
  function clearSelection() {
    if (busy || !selected.length) return;
    selected = [];
    Sound.drop();
    render();
  }

  function shuffle() {
    if (busy) return;
    for (let i = rackOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rackOrder[i], rackOrder[j]] = [rackOrder[j], rackOrder[i]];
    }
    rackOrder.forEach(id => fresh.add(id));
    Sound.shuffle();
    render();
  }

  function swap() {
    if (busy) return;
    const before = new Set(run.round.rack.map(t => t.id));
    const res = GW.swapTiles(run, selected);
    if (!res.ok) { Sound.invalid(); toast(res.error); return; }
    selected = [];
    for (const t of run.round.rack) if (!before.has(t.id)) fresh.add(t.id);
    Sound.shuffle();
    render();
  }

  function moveCharm(k, dir) {
    if (GW.moveCharm(run, k, k + dir)) { focusedCharm = k + dir; Sound.drop(); render(); }
  }
  function sell(k) {
    const id = run.charms[k];
    GW.sellCharm(run, id);
    focusedCharm = null;
    Sound.coin();
    toast(`Sold ${GW.CHARM_BY_ID[id].name} for $${GW.sellValue(id)}`);
    render();
  }

  async function play() {
    if (busy || run.phase !== 'play') return;
    const wordEls = [...$('word').children];
    const charmEls = [...$('charms').children];
    const before = new Set(run.round.rack.map(t => t.id));
    const oldScore = run.round.score;
    const res = GW.playWord(run, selected);
    if (!res.ok) {
      Sound.invalid();
      retrigger($('word'), 'shake');
      toast(res.error);
      return;
    }

    busy = true; fast = false; focusedCharm = null;
    ['btn-play', 'btn-swap', 'btn-shuffle', 'btn-clear'].forEach(id => { $(id).disabled = true; });
    charmEls.forEach(c => c.classList.remove('ready'));
    $('word-label').replaceChildren(el('span', { class: 'ok' }, res.word), res.reversed ? ' (backwards)' : '');
    $('chips').textContent = '0';

    const step = () => wait(fast ? 25 : Math.max(80, Math.min(210, 2600 / res.events.length)));
    let chipStep = 0, multStep = 0;
    for (const ev of res.events) {
      if (ev.base) { setNum('mult', ev.multNow); Sound.mult(0); await step(); continue; }
      const tile = ev.tile != null ? wordEls[ev.tile] : null;
      const charm = ev.charm != null ? charmEls[ev.charm] : null;
      const anchor = charm || tile;
      if (tile) retrigger(tile, 'bump');
      if (charm) retrigger(charm, 'bump');
      if (ev.chips != null) {
        floatText(anchor, `+${ev.chips}`, 'chips');
        setNum('chips', ev.chipsNow);
        Sound.chip(chipStep++);
      }
      if (ev.mult) {
        floatText(anchor, `+${ev.mult} mult`, 'mult');
        setNum('mult', ev.multNow);
        Sound.mult(++multStep);
      }
      if (ev.xmult) {
        floatText(anchor, `×${fmt(ev.xmult)} mult`, 'xmult');
        setNum('mult', ev.multNow);
        Sound.xmult();
        retrigger($('board'), 'punch');
      }
      await step();
    }

    // The total.
    const big = res.total >= run.round.target * 0.5;
    $('equals').textContent = `= ${res.total}`;
    Sound.total(big);
    if (big) retrigger($('app'), 'shake');
    await wait(fast ? 150 : 550);

    // Tiles fly off, the round score counts up.
    wordEls.forEach((t, i) => { t.style.animationDelay = `${i * 30}ms`; t.classList.add('fly'); });
    await countUp(oldScore, run.round.score, fast ? 150 : 500);
    if (res.money) {
      floatText($('money'), `${res.money > 0 ? '+' : '-'}$${Math.abs(res.money)}`, 'money');
      Sound.coin();
    }
    await wait(fast ? 50 : 200);

    selected = [];
    for (const t of run.round.rack) if (!before.has(t.id)) fresh.add(t.id);
    busy = false;
    render();
    afterPlay();
  }

  function countUp(from, to, ms) {
    return new Promise(resolve => {
      const start = performance.now();
      const target = run.round.target;
      const tick = now => {
        const t = Math.min(1, (now - start) / ms);
        const v = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
        $('score').textContent = v;
        $('bar-fill').style.width = `${Math.min(100, (v / target) * 100)}%`;
        if (t < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  function afterPlay() {
    if (run.phase === 'shop' || run.phase === 'won') {
      Sound.clear();
      burst($('bar-fill').parentElement, 60);
      setTimeout(run.phase === 'won' ? showEnd : showShop, 900);
    } else if (run.phase === 'lost') {
      Sound.lose();
      setTimeout(showEnd, 700);
    }
  }

  // ---------- Input ----------
  document.addEventListener('pointerdown', () => { if (busy) fast = true; }, true);
  document.addEventListener('keydown', e => {
    if (busy) { fast = true; e.preventDefault(); return; }
    if (!$('overlay').hidden) {
      if (e.key === 'Escape' && run.phase === 'play') closeModal();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) {
      const free = rackOrder.map(id => run.round.rack.find(t => t.id === id)).filter(t => !selected.includes(t.id));
      const tile = free.find(t => t.letter === key) || free.find(t => t.mod === 'wild');
      if (tile) select(tile.id); else Sound.invalid();
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      if (selected.length) { selected.pop(); Sound.drop(); render(); }
      e.preventDefault();
    } else if (e.key === 'Enter') {
      play(); e.preventDefault();
    } else if (e.key === 'Escape') {
      clearSelection();
    } else if (e.key === ' ') {
      shuffle(); e.preventDefault();
    }
  });

  $('btn-play').addEventListener('click', play);
  $('btn-swap').addEventListener('click', swap);
  $('btn-shuffle').addEventListener('click', shuffle);
  $('btn-clear').addEventListener('click', clearSelection);
  $('btn-help').addEventListener('click', () => showHelp());
  $('btn-mute').addEventListener('click', () => { Sound.toggle(); render(); });

  // ---------- Modals ----------
  function openModal(...children) {
    $('modal').replaceChildren(...children.filter(c => c != null));
    $('overlay').hidden = false;
    const btn = $('modal').querySelector('button.primary');
    if (btn) btn.focus();
  }
  function closeModal() { $('overlay').hidden = true; }

  function showHelp() {
    openModal(
      el('h2', {}, 'How to play'),
      el('p', {}, 'Spell words from your rack of letter tiles to reach each round\'s target score. Clear all 8 rounds to win the run.'),
      el('ul', {},
        el('li', {}, 'Click tiles or type to spell. Words need 3+ letters.'),
        el('li', {}, 'Score = chips × mult. Each letter adds its value in chips. Mult starts from the word length: 3 letters = 1, 4 = 2, 5 = 3, and so on.'),
        el('li', {}, 'You get 4 words a round. Select tiles and press Swap to trade them in (3 swaps a round).'),
        el('li', {}, 'Between rounds, buy charms. They add chips or mult, multiply your mult, or change the rules outright.'),
        el('li', {}, el('strong', {}, 'Charms trigger from left to right. '), 'Put "+mult" charms before "×mult" charms to get the most out of them. Tap a charm to move or sell it.'),
        el('li', {}, 'Charms glow green while you spell if they will trigger for that word.'),
        el('li', {}, 'Rounds 3, 6 and 8 are cursed with an extra rule.'),
        el('li', {}, 'Inks upgrade tiles in your deck: Double, Gold, Wild, Echo and Ghost.')),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: closeModal }, 'Start writing')));
  }

  function shopItemEl(item, index) {
    let kind, name, desc, cls;
    if (item.kind === 'charm') {
      const c = GW.CHARM_BY_ID[item.id];
      kind = `${GW.RARITY[c.rarity].label} charm`; name = c.name; desc = c.desc; cls = c.rarity;
    } else {
      const m = GW.MODS[item.mod];
      kind = 'Ink'; cls = 'ink';
      name = item.mod === 'wild' ? 'Wild tile' : `${m.name} ${item.letter}`;
      desc = item.mod === 'wild' ? `Replaces a random plain tile in your deck. ${m.desc}` : `Turns one of your ${item.letter} tiles ${m.name}. ${m.desc}`;
    }
    return el('div', { class: `shop-item ${cls}${item.sold ? ' sold' : ''}` },
      el('span', { class: 'kind' }, kind),
      el('h3', {}, name),
      el('p', {}, desc),
      el('button', {
        disabled: item.sold || run.money < item.price,
        onclick: () => {
          const r = GW.buy(run, index);
          if (!r.ok) { Sound.invalid(); toast(r.error); return; }
          Sound.coin();
          showShop(); render();
        },
      }, item.sold ? 'Sold' : el('span', { class: 'price' }, `Buy $${item.price}`)));
  }

  function showShop() {
    const r = run.round;
    const nextCurse = run.curseByRound[run.roundIndex + 1];
    const owned = run.charms.map(id => {
      const c = GW.CHARM_BY_ID[id];
      return el('button', { title: c.desc, onclick: () => { GW.sellCharm(run, id); Sound.coin(); showShop(); render(); } },
        `${c.name}: sell $${GW.sellValue(id)}`);
    });
    openModal(
      el('h2', {}, `Round ${run.roundIndex + 1} cleared`),
      el('div', { class: 'payout' },
        el('div', {}, el('span', {}, `Scored ${r.score} of ${r.target}`)),
        ...r.breakdown.map(b => el('div', {}, el('span', {}, b.label), el('span', { class: 'price' }, `+$${b.money}`))),
        el('div', {}, el('strong', {}, 'You have'), el('strong', { class: 'price' }, `$${run.money}`))),
      nextCurse ? el('p', {}, el('strong', {}, `Next round is cursed: ${nextCurse.name}. `), nextCurse.desc) : null,
      el('div', { class: 'shop-items' }, run.shop.items.map(shopItemEl)),
      owned.length ? el('div', {}, el('p', {}, `Your charms (${run.charms.length}/${GW.MAX_CHARMS}). You can reorder them on the main screen.`), el('div', { class: 'row', style: 'justify-content:flex-start' }, owned)) : null,
      el('div', { class: 'row' },
        el('button', { disabled: run.money < run.shop.rerollCost,
          onclick: () => { GW.rerollShop(run); Sound.shuffle(); showShop(); render(); } }, `Reroll $${run.shop.rerollCost}`),
        el('button', { class: 'primary', onclick: () => {
          GW.nextRound(run);
          selected = []; rackOrder = []; focusedCharm = null;
          run.round.rack.forEach(t => fresh.add(t.id));
          closeModal(); Sound.shuffle(); render();
        } }, `Next round (target ${GW.TARGETS[run.roundIndex + 1]})`)));
  }

  function showEnd() {
    const won = run.phase === 'won';
    const best = run.bestWord ? el('p', {}, 'Best word: ', el('strong', {}, run.bestWord.word), ` (${run.bestWord.total} points)`) : null;
    openModal(
      el('h2', {}, won ? 'The manuscript is finished!' : 'Out of words'),
      el('p', {}, won
        ? `You cleared all ${GW.TARGETS.length} rounds with ${run.wordsPlayed} words.`
        : `You reached round ${run.roundIndex + 1} and scored ${run.round.score} of ${run.round.target}.`),
      best,
      run.charms.length ? el('div', { class: 'mini-charms' }, run.charms.map(id => el('span', {}, GW.CHARM_BY_ID[id].name))) : null,
      el('div', { class: 'row' },
        el('button', { onclick: () => startRun(run.seed) }, 'Retry this seed'),
        el('button', { class: 'primary', onclick: () => startRun() }, 'New run')));
  }

  // ---------- Boot ----------
  function startRun(seed) {
    const fromUrl = new URLSearchParams(location.search).get('seed');
    if (seed == null && fromUrl && run == null) seed = Number(fromUrl);
    run = GW.newRun(seed);
    selected = []; rackOrder = []; focusedCharm = null; busy = false;
    run.round.rack.forEach(t => fresh.add(t.id));
    closeModal();
    render();
  }

  startRun();
  let seenHelp = false;
  try { seenHelp = localStorage.getItem('gw-seen-help') === '1'; localStorage.setItem('gw-seen-help', '1'); } catch (e) { /* storage unavailable */ }
  if (!seenHelp) showHelp();
  window.GW_DEBUG = { get run() { return run; }, render };
})();
