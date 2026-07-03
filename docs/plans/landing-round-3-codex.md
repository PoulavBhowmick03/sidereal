# Landing round 3: atmosphere, new sections, text motion

Implementation plan for Codex. Written 2026-07-03 against main @ 9ed53f8.

## Context you need before writing code

- Next.js 14 app router + Tailwind. The landing page is `app/app/(marketing)/page.tsx`, its chrome is `app/app/(marketing)/layout.tsx`, global styles in `app/app/globals.css`, design tokens in `app/tailwind.config.ts`.
- Design system is "cinematic darkroom" monochrome: colors `paper #FFFFFF`, `ink #000000`, `carbon #181818`, `ash #6D6D6D`, `smoke #9A9A9A`, plus ONE accent, `amber #FFAC2E`, reserved for live/active signals only (never decoration, never buttons). Radius is binary: `rounded-none` for panels, `rounded-pill` for controls. The one sanctioned glow is `.glow-signal` / `.glow-signal-dot` on live-signal elements.
- A motion layer already exists and must be reused, not duplicated:
  - `app/lib/useInView.ts` (one-shot IntersectionObserver + `prefersReducedMotion()`)
  - `app/components/Reveal.tsx` (scroll reveal; note its SSR pattern: server renders the FINAL state, a `useEffect` arms the hidden state only on motion-capable clients)
  - `app/components/Parallax.tsx`, `CountUp.tsx`, `InvariantEquation.tsx`, `StepDiagrams.tsx`, `PinnedSteps.tsx`
  - keyframes and `.diag-*`, `.ps-*`, `.lv-*`, `.skeleton`, `.hero-shimmer`, `.page-enter` rules at the bottom of `globals.css`
- The film grain data URI currently lives inline in `app/components/HeroBackground.tsx` (`GRAIN` const).

## Hard constraints (violating any of these is a rejected diff)

1. Zero new dependencies. CSS keyframes + IntersectionObserver only, following the existing patterns.
2. Every animation must be static-complete on the server render and inert under `prefers-reduced-motion` (extend the existing reduced-motion block in `globals.css`). Copy the arm-after-mount pattern from `Reveal.tsx`.
3. e2e literal-text rule: `app/e2e/smoke.spec.ts` asserts the h1 by role/name and the literal text `PT + YT = SY`. Any text-splitting component must preserve exact `textContent` (wrap words in spans WITH real whitespace text nodes between them; never scramble, retype, or uppercase in JS. Uppercasing is CSS only).
4. AGENTS.md section 7: mobile-first (heavy effects gated behind `(hover: hover) and (pointer: fine)` or `lg:`), no dark patterns, and NO invented numbers. New section copy states protocol mechanics, never APYs or market figures.
5. Repo rules: Apache-2.0 SPDX header on every new file, no em dashes in any committed copy, plain prose.
6. Do not touch `contracts/`, `sdk/`, or any `e2e/*.spec.ts`.
7. Amber stays signal-only. The new atmosphere may use white at 3 to 5 percent opacity and the existing starfield nebula tint `rgba(120,140,180, ...)` at up to 6 percent. No other hue, no teal/purple gradient-tech aesthetics.

## Phase A: atmosphere (fix the flat black body)

The problem: hero and footer have atmosphere, but every section between them sits on flat `#000`. The fix is one fixed background layer that the dark sections let show through, unifying hero (metallic) to body (deep space) to footer (starfield).

1. **Extract grain.** New `app/components/Grain.tsx`: server component rendering a `pointer-events-none` div with the `GRAIN` background tile, `opacity-[0.04] mix-blend-overlay`. Import and use it in `HeroBackground.tsx` (replacing the inline copy) and render one `fixed inset-0 z-0` instance from the marketing layout so the whole page is grained.
2. **New `app/components/Atmosphere.tsx`** (client not needed, pure CSS): `fixed inset-0 z-0 pointer-events-none`, containing
   - a base vertical gradient `#000000` at top through `#05070d` mid to `#080a10` at bottom (the footer starfield base color, so the reveal footer reads as the gradient's destination);
   - two very large radial washes ("nebulae"), one white at 3 percent, one `rgba(120,140,180,0.05)`, each on its own 45 to 60 second ease-in-out drift keyframe (transform translate/scale only, no filter animation);
   - both washes hidden below `lg:` (phones get the plain gradient).
3. **Let sections show it.** In `(marketing)/page.tsx` change the dark sections from `bg-ink` to `bg-transparent` (hero section, protocol overview section). In `PinnedSteps.tsx` phase 1 and 3 use transparent instead of `bg-ink`; phase 2 keeps `bg-carbon` (opaque is correct there, the crossfade still works). Keep `bg-paper` (invariant band) and the stacked mobile step bands opaque. The marketing layout's `<main>` also carries `bg-ink`: make it transparent and move the fallback color to the body.
4. **Gradient hairlines.** Add a `.hairline` utility in `globals.css`: 1px tall, `background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)`. Use it as the divider above the protocol overview section and above the footer content instead of `border-white/10` where a full-bleed divider exists.
5. **Card spotlight (desktop only).** New `app/components/Spotlight.tsx` client component: wraps children, on `pointermove` sets `--mx`/`--my` CSS vars; a `::before` overlay paints `radial-gradient(200px circle at var(--mx) var(--my), rgba(255,255,255,0.05), transparent)`, opacity 0 until hover. Gate with `(hover: hover) and (pointer: fine)`. Apply to the FACTS cells and the new Phase B cards. rAF-throttle the pointermove like `Parallax.tsx` does.

## Phase B: new landing sections

Insert between the `#how-it-works` section and the protocol overview section, in this order.

1. **Ticker band (rolling line).** New `app/components/TickerBand.tsx`.
   - Content, mono `label-data` voice, protocol facts only: `PT + YT = SY / Internal TWAP / No external oracles / Client-side signing / Blend USDC / 3-month maturity` separated by `·`.
   - Structure: an `overflow-hidden` band with hairline top/bottom borders; inside, a flex row containing the fact sequence twice, the second copy `aria-hidden`. Animate the row `translateX(0 -> -50%)` linear infinite, about 40s. Pause under reduced motion (static first copy visible, animation none).
   - IMPORTANT: this duplicates the literal string `PT + YT = SY`. The smoke test uses `getByText("PT + YT = SY")` which fails on multiple matches. Use a spaced variant in the ticker (`PT plus YT equals SY` is ugly; instead use `1 PT + 1 YT = 1 SY`) so the assertion still matches exactly one node. Verify by running the smoke spec.
2. **"Who it is for" section.** Three editorial cards: fixed-rate buyer (hold PT to maturity), yield trader (buy YT for leveraged yield exposure), liquidity provider (single PT/SY pool, fees from every route). New `app/components/AudienceCards.tsx` or inline in the page.
   - Card: `rounded-none`, transparent fill, and a **self-drawing border**: an absolutely positioned SVG `<rect>` covering the card, `pathLength=1`, `stroke-dasharray: 1`, dashoffset 1 to 0 over 1.2s when in view (reuse the `useInView` + arm pattern; stagger the three cards 150ms apart). After the draw, copy reveals inside with the existing `Reveal`.
   - Each card ends in an arrow link: `Lock a rate -> /trade`, `Trade yield -> /trade#buy-yt`, `Provide liquidity -> /pool`. Use the rolling-text hover from Phase C on these links.
   - Copy: mechanics only, no rates. Model the voice on the existing LEGS copy.
3. **Guarantees strip.** Full-width section, kicker `Design / Guarantees`, four rows: internal TWAP only (no oracle in the pricing path), PT + YT = SY enforced by the tokenizer (phrase it without the exact equation string, e.g. "one PT plus one YT always recombines into one SY"), all transactions signed client-side, Apache-2.0 open source.
   - Left edge: a vertical 1px line that draws downward (`scaleY` 0 to 1, `origin-top`, 1.5s) as the section enters; each row's marker dot pops (`diag-pop` reuse) in sequence, 200ms stagger.
   - Rows are `grid` with an oversized row index (`01` to `04`) in `text-white/20`, mirroring the step numeral language.

## Phase C: text motion

1. **`app/components/WordReveal.tsx`.** Client component for section headings: splits `children` (plain string prop, not arbitrary nodes) into words; each word wrapped in an `overflow-hidden` inline-block span containing an inner span that transitions `translateY(110%) -> 0`, staggered 40ms per word, triggered by `useInView`. Whitespace must be preserved as real text nodes between the word wrappers so `textContent` is unchanged. Server renders settled state; arm after mount.
   - Apply to the section h2s: `Protocol overview`, and the new sections' headings. Do NOT apply to the h1 (it has the shimmer) or to `PT + YT = SY` (owned by `InvariantEquation`).
2. **Rolling hover links.** Add a `.roll` recipe in `globals.css`: the link gets `overflow-hidden`; inner structure is two stacked copies of the label (second `aria-hidden`), `translateY` 0 to -100% on hover, 250ms `cubic-bezier(0.22, 1, 0.36, 1)`. Build it as `app/components/RollingLink.tsx` so the duplicate markup stays consistent. Apply to: marketing nav links, the footer links, and the new card CTAs. NOT the Launch App pill (it is asserted by role/name in e2e; a duplicated text node changes the accessible name to "Launch App Launch App" unless the duplicate is aria-hidden AND the first copy stays a real text node; if you apply it there, verify `getByRole("link", { name: /launch app/i })` still resolves to one element).
3. **Kicker wipe.** `label-data` kickers in the new sections get a `clip-path: inset(0 100% 0 0)` to `inset(0 0 0 0)` transition (0.6s) on in-view. Pure CSS class + the armed pattern, no per-character work.

## Phase D: verification (run after each phase, all must pass)

```bash
cd app
pnpm typecheck && pnpm lint && pnpm test
pnpm exec playwright test smoke interactions   # both viewport projects
```

Then a manual screenshot pass (playwright script or browser): 1440px and 393px widths, plus one run with `page.emulateMedia({ reducedMotion: "reduce" })` confirming: no marquee movement, sections fully readable, pinned steps replaced by stacked bands. Watch for: layout shift from the ticker (give the band a fixed height), horizontal overflow from the marquee (overflow-hidden on the band, not the body), and the `PT + YT = SY` single-match assertion.

## Explicitly out of scope

- No framer-motion, GSAP, lenis, or any smooth-scroll hijacking.
- No color beyond the palette + the two atmosphere tints listed above.
- No copy with numbers that are not protocol constants (3-month maturity and 1:1 redemption are fine; any APY is not).
- No changes to the hero, InvariantEquation, PinnedSteps interior logic, footer reveal, or app screens.
