// Ghostwriter: rendering and input. All rules live in logic.js (window.GW).
(function () {
  'use strict';
  const GW = window.GW;
  const $ = id => document.getElementById(id);

  let run = null;
  let selected = []; // tile ids, in spelling order
  let rackOrder = []; // tile ids, display order (shuffle only changes this)

  // ---------- Helpers ----------
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) e.append(c);
    return e;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function tileEl(tile, opts) {
    const value = tile.mod === 'wild' ? 0 : (GW.LETTER_VALUES[tile.letter] || 0) * (tile.mod === 'double' ? 2 : 1);
    const title = tile.mod ? `${GW.MODS[tile.mod].name}: ${GW.MODS[tile.mod].desc}` : `${tile.letter}: ${value} chips`;
    return el('button', {
      class: `tile${tile.mod ? ' mod-' + tile.mod : ''}${opts.used ? ' used' : ''}`,
      title, 'aria-label': `${tile.letter === '?' ? 'wild' : tile.letter}${tile.mod ? ' ' + tile.mod : ''}`,
      onclick: opts.onclick,
    },
    tile.letter,
    el('span', { class: 'val' }, String(value)),
    tile.mod && tile.mod !== 'wild' ? el('span', { class: 'mod' }, GW.MODS[tile.mod].name[0]) : null);
  }

  function syncRackOrder() {
    const ids = run.round.rack.map(t => t.id);
    rackOrder = rackOrder.filter(id => ids.includes(id));
    for (const id of ids) if (!rackOrder.includes(id)) rackOrder.push(id);
    selected = selected.filter(id => ids.includes(id));
  }

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

    const curse = $('curse');
    curse.hidden = !r.curse;
    if (r.curse) curse.replaceChildren(el('strong', {}, `Cursed: ${r.curse.name}. `), r.curse.desc);

    const charms = $('charms');
    charms.replaceChildren();
    if (!run.charms.length) charms.append(el('div', { class: 'charm-empty' }, `No charms yet. Buy them between rounds (max ${GW.MAX_CHARMS}).`));
    for (const id of run.charms) {
      const c = GW.CHARM_BY_ID[id];
      let label = c.name;
      if (id === 'scribe' && run.charmState.scribe) label += ` (+${run.charmState.scribe})`;
      charms.append(el('span', { class: 'charm', title: c.desc }, label));
    }

    const byId = new Map(r.rack.map(t => [t.id, t]));
    $('word').replaceChildren(...selected.map(id => tileEl(byId.get(id), { onclick: () => unselect(id) })));
    $('rack').replaceChildren(...rackOrder.map(id => {
      const used = selected.includes(id);
      return tileEl(byId.get(id), { used, onclick: () => select(id) });
    }));

    renderPreview();
    $('played').replaceChildren(...r.played.map(p => el('li', {}, p.word, el('b', {}, `+${p.total}`))));

    const playing = run.phase === 'play';
    $('btn-play').disabled = !playing || selected.length < 3;
    $('btn-swap').disabled = !playing || !selected.length || r.swapsLeft <= 0;
  }

  function renderPreview() {
    const p = $('preview');
    if (selected.length === 0) { p.textContent = 'Click tiles or type to spell a word.'; return; }
    const tiles = selected.map(id => run.round.rack.find(t => t.id === id));
    if (tiles.length < 3) { p.textContent = ''; return; }
    const res = GW.evaluate(run, tiles, true);
    if (!res.ok) { p.replaceChildren(el('span', { class: 'err' }, res.error)); return; }
    const xm = res.xmult !== 1 ? ` × ${+res.xmult.toFixed(2)}` : '';
    const shown = tiles.some(t => t.mod === 'wild') ? `${res.word}: ` : '';
    p.replaceChildren(`${shown}${res.chips} chips × ${res.mult} mult${xm} = `, el('span', { class: 'total' }, String(res.total)));
  }

  // ---------- Actions ----------
  function select(id) {
    if (run.phase !== 'play' || selected.includes(id)) return;
    selected.push(id);
    render();
  }
  function unselect(id) {
    selected = selected.filter(s => s !== id);
    render();
  }
  function clearSelection() { selected = []; render(); }

  function shuffle() {
    for (let i = rackOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rackOrder[i], rackOrder[j]] = [rackOrder[j], rackOrder[i]];
    }
    render();
  }

  function play() {
    if (run.phase !== 'play') return;
    const res = GW.playWord(run, selected);
    if (!res.ok) { toast(res.error); return; }
    selected = [];
    let msg = `${res.word} +${res.total}`;
    if (res.gold) msg += ` · +$${res.gold}`;
    toast(msg);
    render();
    afterPlay();
  }

  function swap() {
    const res = GW.swapTiles(run, selected);
    if (!res.ok) { toast(res.error); return; }
    selected = [];
    render();
  }

  function afterPlay() {
    if (run.phase === 'shop') setTimeout(showShop, 500);
    else if (run.phase === 'won' || run.phase === 'lost') setTimeout(showEnd, 500);
  }

  // ---------- Keyboard ----------
  document.addEventListener('keydown', e => {
    if (!$('overlay').hidden) {
      if (e.key === 'Escape' && run.phase === 'play') closeModal();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (/^[A-Z]$/.test(key)) {
      const free = rackOrder.map(id => run.round.rack.find(t => t.id === id)).filter(t => !selected.includes(t.id));
      const tile = free.find(t => t.letter === key) || free.find(t => t.mod === 'wild');
      if (tile) select(tile.id);
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      selected.pop(); render(); e.preventDefault();
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
      el('p', {}, 'Spell words from your rack of letter tiles to reach each round\'s target score. Clear all 8 rounds to win.'),
      el('ul', {},
        el('li', {}, 'Click tiles or type to spell. Words need 3+ letters.'),
        el('li', {}, 'Score = chips (the sum of the letter values) × mult. Mult grows with length: 3 letters = 1, 4 = 2, 5 = 3, and so on.'),
        el('li', {}, 'You get 4 words per round. Select tiles and press Swap to trade them for new ones (3 swaps per round).'),
        el('li', {}, 'Rounds 3, 6 and 8 are cursed with an extra rule.'),
        el('li', {}, 'Between rounds, spend money on charms (passive bonuses) and inks (special tiles). Unused words pay $1 each.')),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: closeModal }, 'Got it')));
  }

  function shopItemEl(item, index) {
    let kind, name, desc;
    if (item.kind === 'charm') {
      const c = GW.CHARM_BY_ID[item.id];
      kind = 'Charm'; name = c.name; desc = c.desc;
    } else {
      const m = GW.MODS[item.mod];
      kind = 'Ink';
      name = item.mod === 'wild' ? 'Wild tile' : `${m.name} ${item.letter}`;
      desc = item.mod === 'wild' ? `Replaces a random plain tile in your deck. ${m.desc}` : `Turns one of your ${item.letter} tiles ${m.name}. ${m.desc}`;
    }
    return el('div', { class: `shop-item${item.sold ? ' sold' : ''}` },
      el('span', { class: 'kind' }, kind),
      el('h3', {}, name),
      el('p', {}, desc),
      el('button', {
        disabled: item.sold || run.money < item.price,
        onclick: () => { const r = GW.buy(run, index); if (!r.ok) toast(r.error); showShop(); render(); },
      }, item.sold ? 'Sold' : el('span', { class: 'price' }, `Buy $${item.price}`)));
  }

  function showShop() {
    const r = run.round;
    const owned = run.charms.map(id => {
      const c = GW.CHARM_BY_ID[id];
      return el('button', { title: c.desc, onclick: () => { GW.sellCharm(run, id); showShop(); render(); } },
        `${c.name}: sell $${Math.floor(c.price / 2)}`);
    });
    const nextCurse = run.curseByRound[run.roundIndex + 1];
    openModal(
      el('h2', {}, `Round ${run.roundIndex + 1} cleared`),
      el('p', {}, `Scored ${r.score} / ${r.target}. Earned $${r.earned}. You have `, el('span', { class: 'price' }, `$${run.money}`), '.'),
      nextCurse ? el('p', {}, el('strong', {}, `Next round is cursed: ${nextCurse.name}. `), nextCurse.desc) : null,
      el('div', { class: 'shop-items' }, run.shop.items.map(shopItemEl)),
      owned.length ? el('div', {}, el('p', {}, `Your charms (${run.charms.length}/${GW.MAX_CHARMS}):`), el('div', { class: 'owned' }, owned)) : null,
      el('div', { class: 'row' },
        el('button', { disabled: run.money < run.shop.rerollCost,
          onclick: () => { GW.rerollShop(run); showShop(); render(); } }, `Reroll $${run.shop.rerollCost}`),
        el('button', { class: 'primary', onclick: () => {
          GW.nextRound(run); selected = []; rackOrder = []; closeModal(); render();
        } }, `Next round (target ${GW.TARGETS[run.roundIndex + 1]})`)));
  }

  function showEnd() {
    const won = run.phase === 'won';
    const best = run.bestWord ? `Best word: ${run.bestWord.word} (${run.bestWord.total}).` : '';
    openModal(
      el('h2', {}, won ? 'The manuscript is finished!' : 'Out of words'),
      el('p', {}, won
        ? `You cleared all ${GW.TARGETS.length} rounds. ${best}`
        : `Round ${run.roundIndex + 1}: ${run.round.score} / ${run.round.target}. ${best}`),
      el('div', { class: 'row' },
        el('button', { onclick: () => startRun(run.seed) }, 'Retry seed'),
        el('button', { class: 'primary', onclick: () => startRun() }, 'New run')));
  }

  // ---------- Boot ----------
  function startRun(seed) {
    const fromUrl = new URLSearchParams(location.search).get('seed');
    if (seed == null && fromUrl && run == null) seed = Number(fromUrl);
    run = GW.newRun(seed);
    selected = []; rackOrder = [];
    closeModal();
    render();
  }

  startRun();
  let seenHelp = false;
  try { seenHelp = localStorage.getItem('gw-seen-help') === '1'; localStorage.setItem('gw-seen-help', '1'); } catch (e) { /* storage unavailable */ }
  if (!seenHelp) showHelp();
})();
