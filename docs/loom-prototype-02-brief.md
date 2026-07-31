# Loom — Prototype 02: The Seam

**Owner:** Wickus
**Build target:** 5–7 days
**Builds on:** Prototype 01 (drag loop, passed 3/3 return test)

---

## The one question

> Shown their own cloth next to two strangers' cloths, can a player pick out theirs — and say *why*?

That's the whole test. If they can, the system reads as **authorship** and we have a moat. If they can't, it reads as **decoration** and we have a screensaver.

This is a harder and more interesting question than Prototype 01's, and it is entirely falsifiable. Do not soften it.

---

## Design principle — non-negotiable

**Every visual change must be traceable to something the player did and already knows they did.**

Randomness is permitted in *how* a trait renders. Never in *whether* something changed. If a band looks different and there is no player action that explains it, the system has failed regardless of how pretty it is.

---

## Still OUT of scope

- Economy, IAP, ads, currency
- Seasons, season pass, unlocks
- Accounts, backend, sync, sharing
- Menus, settings, onboarding text
- Any art direction beyond the generated weave itself

---

## The four traits

Captured **at the moment a row weaves**, from the placements that contributed to that row.

| Trait | Computation | Range |
|---|---|---|
| **Density** | fraction of cells in the rows immediately above and below that are filled at weave moment | 0–1 |
| **Bias** | mean x-position of contributing placements, normalised from board centre | −1 to +1 |
| **Tempo** | median ms from piece pickup to release across contributing placements; clamp 200–3000ms, then normalise | 0–1 |
| **Setup** | number of rows weaving simultaneously in this event; clamp 1–4, then normalise | 0–1 |

Each woven row stores a `TraitVector { density, bias, tempo, setup }` permanently. This never recomputes.

### Why these four

Each is something the player is already dimly aware of about their own play. That awareness is what makes the output legible as *theirs* rather than as noise. Do not add a fifth trait without removing one — legibility degrades fast past four.

---

## Rendering

Map each trait to one visual channel. **One trait, one channel.** Do not let two traits drive the same property or the cloth becomes unreadable.

- **Density → thread tightness.** High density = fine, closely spaced threads. Low = open, airy weave.
- **Bias → drift.** The band's pattern skews left or right across its width.
- **Tempo → colour temperature.** Fast, decisive play runs warm. Slow, deliberate play runs deep and cool.
- **Setup → banding complexity.** Single weaves render as one simple pass. Multi-row weaves render as layered passes.

Within those constraints, render however looks best. Randomness in texture detail is fine and encouraged — just not in which direction a channel moves.

---

## Front-loading the divergence

**The problem:** almost nobody reaches the hours where character would emerge naturally. So we exaggerate early and settle late.

Apply an amplification factor to each band's traits based on its index `N` in the cloth:

```
amplified = 0.5 + (raw - 0.5) * (1 + k / (N + c))
```

Starting values: `k = 6`, `c = 2`.

That gives roughly:
- Band 1 → ~3.0× amplification (differences are unmissable immediately)
- Band 10 → ~1.5×
- Band 50 → ~1.1× (cloth has settled into a calm, consistent character)

**These two constants are the most important numbers in the system.** Expose them in the debug menu and tune them against real play. Everything else can be approximated; this cannot.

Clamp amplified values to their valid range so early bands don't blow out.

---

## Persistence and session continuity

- Cloth stored in `localStorage` as an ordered array of `TraitVector`s
- On session start, the **last three woven bands render at the top of the board**, already visible
- Starting palette shifts a fraction toward the running average of the cloth
- **No reset, no "new game," no session boundary visible to the player** — they are continuing the same cloth
- Inheritance advances on *sessions played*, never on calendar days. Miss a week, pick up exactly where you left off. No decay, no streak, no unravelling.

---

## Cloth view

Minimum viable: drag downward on the board to scroll up through the accumulated cloth. Release to return.

No gallery UI, no frames, no titles, no stats. Just the cloth.

---

## Edge case worth getting right

A very consistent player produces a uniform cloth. **That is a valid signature, not a bug.** Low variance must render as calm and deliberate, not as broken or empty. Check this explicitly — it's the easiest failure to ship by accident.

---

## Acceptance criteria

- [ ] Two players playing differently for 15 minutes produce visibly different cloths
- [ ] The same player's cloth is recognisably continuous across a session boundary
- [ ] A tired, slow session and a sharp, fast session produce visibly different bands within the same cloth
- [ ] Low-variance play renders as calm, not broken
- [ ] Cloth persists across app close and device restart
- [ ] Still no text on screen anywhere

---

## The test

Needs at least 4 testers who have each played 15+ minutes.

1. Export three cloths as images: the tester's own, plus two others'.
2. Present them side by side, unlabelled, in random order.
3. Ask: **"Which of these is yours?"**
4. Then ask: **"How do you know?"**

Question 4 is the real one. Correct identification could be luck. A correct answer *with a reason that maps to an actual trait* — "mine's tighter," "mine leans left," "mine's warmer" — means the system is legible.

**Pass:** majority identify correctly AND give a trait-based reason.
**Marginal:** identify correctly but can't say why → the signal exists but is too subtle. Raise `k`.
**Fail:** cannot identify above chance → the traits aren't reaching the render. Diagnose before adding anything.

---

## What happens after

**On pass:** the moat is real. Move to season structure and the first-session flow, then store prep.
**On fail:** do not add traits or visual complexity to compensate — that's the instinct and it's wrong. Take the single strongest trait, amplify it hard, and retest. One legible signal beats four illegible ones.
