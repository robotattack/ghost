// Ghostwriter: synthesized sound effects (Web Audio, no asset files).
(function (root) {
  'use strict';
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('gw-muted') === '1'; } catch (e) { /* storage unavailable */ }

  function ac() {
    if (!ctx) {
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Major pentatonic steps, so rising sequences always sound pleasant.
  const PENTA = [0, 2, 4, 7, 9];
  const note = (base, step) => base * Math.pow(2, (PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);

  function tone({ freq, type = 'sine', dur = 0.12, vol = 0.2, delay = 0, slide, attack = 0.004 }) {
    const a = ac(); if (!a || muted) return;
    const t = a.currentTime + delay;
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise({ dur = 0.05, vol = 0.3, freq = 2000, q = 1, delay = 0 }) {
    const a = ac(); if (!a || muted) return;
    const t = a.currentTime + delay;
    const len = Math.ceil(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const Sound = {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('gw-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!muted) Sound.coin();
      return muted;
    },
    // A wooden tile being picked up; pitch climbs as the word grows.
    pick(i) {
      noise({ dur: 0.04, vol: 0.5, freq: 2400 + i * 120, q: 4 });
      tone({ freq: note(330, i), type: 'triangle', dur: 0.08, vol: 0.08 });
    },
    drop() { noise({ dur: 0.05, vol: 0.35, freq: 900, q: 3 }); },
    chip(i) { tone({ freq: note(523, i), type: 'triangle', dur: 0.1, vol: 0.14 }); },
    mult(i) {
      tone({ freq: note(262, i), type: 'square', dur: 0.12, vol: 0.06 });
      tone({ freq: note(262, i) * 2, type: 'sine', dur: 0.1, vol: 0.08 });
    },
    xmult() {
      tone({ freq: 392, type: 'sawtooth', dur: 0.25, vol: 0.06, slide: 784 });
      tone({ freq: 523, type: 'square', dur: 0.2, vol: 0.05, delay: 0.06, slide: 1046 });
      noise({ dur: 0.12, vol: 0.2, freq: 5000, q: 0.7 });
    },
    total(big) {
      [0, 2, 4, 5].forEach((s, i) => tone({ freq: note(big ? 392 : 330, s + 3), type: 'triangle', dur: 0.25, vol: 0.12, delay: i * 0.05 }));
      if (big) noise({ dur: 0.3, vol: 0.25, freq: 300, q: 0.5 });
    },
    invalid() {
      tone({ freq: 180, type: 'sawtooth', dur: 0.18, vol: 0.07, slide: 110 });
      noise({ dur: 0.06, vol: 0.2, freq: 400, q: 2 });
    },
    shuffle() {
      for (let i = 0; i < 6; i++) noise({ dur: 0.03, vol: 0.25, freq: 1800 + Math.random() * 1500, q: 4, delay: i * 0.03 });
    },
    coin() {
      tone({ freq: 988, type: 'square', dur: 0.08, vol: 0.05 });
      tone({ freq: 1319, type: 'square', dur: 0.2, vol: 0.05, delay: 0.07 });
    },
    clear() {
      [0, 2, 4, 5, 7, 10].forEach((s, i) => tone({ freq: note(262, s + 5), type: 'triangle', dur: 0.3, vol: 0.12, delay: i * 0.08 }));
    },
    lose() {
      [7, 5, 3, 0].forEach((s, i) => tone({ freq: note(196, s), type: 'triangle', dur: 0.4, vol: 0.12, delay: i * 0.18 }));
    },
  };
  root.Sound = Sound;
})(window);
