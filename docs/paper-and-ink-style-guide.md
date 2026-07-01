# "Paper & Ink" Design System — Deal (Planning Poker)

## Concept

An analog, human alternative to the typical SaaS dashboard. The app should feel like a real planning session — index cards, hairline rules, a serif hand — digitized without being sanitized. All visual "boldness" is reserved for one moment: **the reveal**, marked with a red rubber-stamp accent. Everywhere else, the palette stays quiet and paper-toned so that moment reads as significant.

Core tension the UI is built around: **private voting (muted, face-down) → public reveal (saturated, stamped)**. Every screen should make clear which of these two states it's in.

---

## Color

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F2ECE1` | App background |
| `--paper-card` | `#FBF8F1` | Card faces, elevated surfaces |
| `--ink` | `#2A2420` | Primary text, borders, high-contrast UI |
| `--ink-soft` | `#7A7062` | Secondary text |
| `--ink-faint` | `#A79C89` | Tertiary/label text, disabled states |
| `--rule` | `#D9CFB9` | Hairline dividers, dashed card rules |
| `--stamp` | `#A6392C` | **Accent — reserved for reveal state only**: stamp mark, "you" tag, outlier values, primary CTA border |
| `--stamp-soft` | `rgba(166,57,44,0.10)` | Rare tinted backgrounds behind stamp accents |

**Rule:** `--stamp` red never appears during the voting/private phase. It only activates on reveal — that's what makes the reveal feel like something happened. If a screen needs an accent color elsewhere, don't reach for red first; prefer ink-on-paper contrast instead.

Background gets a near-invisible texture: a repeating 1px horizontal gradient at ~1.2% opacity over the paper color, to avoid a flat, digital-feeling fill.

---

## Typography

Three typefaces, each with a fixed job. Never mix their roles.

1. **Fraunces** (serif, display) — headings, the brand mark, card point-values, stat numbers. Has warmth and a slightly wonky, handmade character at larger sizes. Weights used: 500–700.
2. **Source Serif 4** (serif, body) — names, prompts, running text, roster entries. Weight 400–500.
3. **IBM Plex Mono** (monospace) — anything data-like or systemic: labels, session codes, ticket IDs, timestamps, status text, button text, stat labels. Always uppercase with `letter-spacing: 0.06–0.1em` when used as a label.

No sans-serif anywhere. That absence is part of the identity — it's what keeps the UI feeling like paper instead of an app.

---

## The card

The signature object. A physical index/playing card, not a flat chip.

- Size: full card ~76×106px (table/reveal context), hand card ~58×82px (smaller, in-hand context)
- `background: var(--paper-card)`, `border: 1px solid var(--ink)`, `border-radius: 3px`
- Soft double shadow: a hairline `0 1px 0 rgba(0,0,0,0.04)` plus a diffuse `0 6px 14px rgba(42,36,32,0.10)` — mimics a card resting on felt, not a flat drop shadow
- A dashed hairline inset ~6px from the top and bottom edges (`border-top/bottom: 1px dashed var(--rule)`) — evokes a printed index card's margin rule
- Value is centered, set in Fraunces, bold
- Every card in a group gets a small individual rotation (roughly −3° to +3°, alternating/varied per card) — never perfectly aligned. This is what sells "cards on a table" over "UI elements in a row."
- Selected/active card: lifts (`translateY(-16px)`), rotation resets to 0°, border switches to `--stamp`, value text switches to `--stamp`
- Face-down card (used in the roster list, small ~16×22px): a diagonal striped pattern alternating paper and rule color, same ink border — represents "voted, hidden" without showing the value

---

## Layout patterns

- Two-column shell: a large table/play area (~flexible width) + a fixed-width roster sidebar (~260px), separated by a single hairline vertical rule. Stacks to one column under ~820px.
- Header: brand mark (left) + current ticket/story title (right), separated from the body by a single hairline rule. No card/box container around the header — it's just ink on paper.
- Phase state is always shown as a segmented tab control (bordered rectangle, ink border, active tab inverted to solid ink/paper-card text) — labeled in the mono type, uppercase. This is the one piece of chrome that's allowed to look "app-like."
- Generous whitespace; the table area centers its contents rather than filling every pixel. Paper doesn't get cluttered.

---

## The two states

### Voting (private)
- Table area shows a short serif prompt ("Everyone's choosing in private...") and a live count ("4 of 6 have voted")
- Player's own hand is fanned along the bottom: all point values as small cards, individually rotated, one liftable/selectable
- Roster sidebar shows each player's name with either a small face-down card icon (voted) or an italic serif "thinking…" in faint ink (not yet voted) — never the value itself
- No red anywhere on this screen

### Revealed (public)
- All cards flip face-up and fan out across the table area, each still individually rotated, name in serif beneath each
- A rubber-stamp mark ("REVEALED") appears top-right of the table area: mono type, uppercase, bordered box in `--stamp`, rotated ~8°, ~85% opacity — reads like an actual ink stamp, not a badge
- Any outlier value (meaningfully off from the group) gets its card border and value recolored to `--stamp` — draws the eye without needing an explanit label
- Below the cards: three stats (average / median / spread) in Fraunces numerals with mono labels underneath, separated from the cards by a hairline rule
- A short italic serif note calls out consensus or disagreement in plain language
- Roster sidebar now shows each player's actual value (mono, `--stamp` color) instead of a card-back icon
- Two actions at the bottom: a plain outlined "Discuss" button and a solid ink "Re-deal round" primary button, both in uppercase mono type

---

## Motion (implied, for real implementation)

Nothing here is animated in the static mock, but the system implies:
- Hand cards: hover lifts slightly and un-rotates (150ms ease)
- The voting → reveal transition should feel like a physical flip/turn, not a fade or slide — this is the app's one big animated moment and deserves particular care
- The stamp mark could land with a slight overshoot/thud rather than fading in, to sell the "stamped down" feeling

---

## Guardrails for implementation

- Don't introduce a fourth typeface or a sans-serif for "just this one label" — route it through mono instead.
- Don't use `--stamp` red as a generic accent/link color. It signals "revealed / important deviation," and loses meaning if it shows up everywhere.
- Keep card rotation subtle (≤3°) and varied — uniform rotation across all cards looks like a bug, not a feature.
- Any new UI chrome (modals, toasts, dropdowns) should default to ink-on-paper with hairline borders before reaching for shadows, gradients, or rounded pill shapes — the system is intentionally flat and linear except for the cards themselves.
