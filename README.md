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
- Rounds 3, 6 and 8 are **cursed** with an extra rule.
- Clearing a round pays $4 plus $1 per unused word.

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
| `src/ui.js`              | Rendering, mouse and keyboard input, modals.           |
| `src/words.js`           | Generated dictionary (3–12 letters).                   |
| `scripts/build-words.mjs`| Regenerates `src/words.js` from the `word-list` package. |
| `test/logic.test.mjs`    | Rule tests. Run with `npm test`.                       |

To add a charm, append an entry to `CHARMS` in `src/logic.js`. It needs a `score(ctx, s)`
hook that adjusts `s.chips`, `s.mult` or `s.xmult`, or a `roundEnd(run, round)` hook
that returns bonus money.

## Credits

Dictionary from [word-list](https://github.com/sindresorhus/word-list) (MIT).
