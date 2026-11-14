# Ghostwriter

A roguelike word-scoring puzzle game. Spell words from a rack of letter tiles to hit
a score target each round. Between rounds, buy **charms** (passive scoring rules) and
**inks** (special tiles) to build up an engine that can beat all 8 rounds.

## Play

Open `index.html` in a browser. No build step or server is needed.
(Or run `npm start` to serve it locally.)

Add `?seed=123` to the URL to replay a specific run.

## Rules

- **Score = chips × mult.** Chips are the sum of the letter values. Mult comes from
  word length (3 letters = 1, 4 = 2, 5 = 3, …), plus any charm bonuses.
- Each round gives you **4 words** and **3 swaps**. Your rack holds 12 tiles drawn from
  your deck.
- Rounds 3, 6 and 8 are **cursed** with an extra rule (8 curses, 3 picked per run).
- Clearing a round pays $4 plus $1 per unused word.

### Charms

You hold up to 5 charms. They **trigger left to right**, so order matters:
`+4 mult` then `×3 mult` beats `×3` then `+4`. Tap a charm to move or sell it.
While you spell, charms that will trigger for the current word glow green.

There are 33 charms in three rarities:

- **Common:** flat bonuses, e.g. +4 mult for words starting with a vowel, +4 chips
  per repeated letter.
- **Uncommon:** conditional ×mult and synergies, e.g. ×2 for a doubled letter,
  ×3 on your last word of a round, Gold tiles give +6 mult, a charm that keeps growing.
- **Rare:** rule-changers, e.g. a bigger rack, an extra word per round, spelling
  backwards, Copycat (copies the charm to its right), ×1.5 per empty slot.

### Special tiles (inks)

| Ink    | Effect                                 |
|--------|----------------------------------------|
| Double | Scores twice its letter value          |
| Gold   | Earns $1 when played                   |
| Wild   | Stands in for any letter, scores 0     |
| Echo   | Returns to your rack after being played |
| Ghost  | +3 mult when played                    |

## Code layout

| File                     | Purpose                                                |
|--------------------------|--------------------------------------------------------|
| `src/logic.js`           | All game rules: scoring, charms, curses, shop. No DOM. |
| `src/ui.js`              | Rendering, input, the step-by-step scoring animation.  |
| `src/audio.js`           | Synthesized sound effects (Web Audio, no asset files). |
| `src/words.js`           | Generated dictionary (3–12 letters).                   |
| `scripts/build-words.mjs`| Regenerates `src/words.js` from the `word-list` package. |
| `test/logic.test.mjs`    | Rule tests. Run with `npm test`.                       |

To add a charm, append an entry to `CHARMS` in `src/logic.js`. The hooks are documented
above the list: `tile` (per letter), `word` (per word), `onPlay` (to grow over time),
`rules` (change rack size, words per round, etc.) and `roundEnd` (bonus money). Scoring
hooks call `add({chips, mult, xmult})`. Each call becomes one beat of the scoring
animation, so the UI picks up new charms with no extra work.

## Credits

Dictionary from [word-list](https://github.com/sindresorhus/word-list) (MIT).
