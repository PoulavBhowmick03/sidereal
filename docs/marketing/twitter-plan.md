# Sidereal Twitter/X plan

Prepared for human review. Nothing in this file has been posted anywhere, and nothing
should be posted without a human pass. Every claim below traces to the repo as of
commit `610b78a` (2026-07-04) or to a source already cited in `README.md` /
`ARCHITECTURE.md`. Contract addresses come from `deployments/testnet.toml`
(deployed 2026-07-03); pull the current manifest before posting, since testnet
redeploys happen.

House rules honored throughout: no em dashes, no invented numbers, no exclamation
marks, testnet stated plainly, no financial advice.

---

## Deliverable 1: the tweets

### Media asset key

Screenshots captured this session at 1440px and 390px, saved in
`docs/marketing/assets/` (uncommitted). Recordings are specified for a human to
capture; each is 5 to 10 seconds, captured at 1440px unless noted.

| ID | Asset | What it shows |
|---|---|---|
| IMG-HERO | `landing-hero-1440.png` / `-390.png` | Liquid-metal hero, "Split Stellar yield into principal and yield." |
| IMG-INV | `invariant-band-1440.png` / `-390.png` | PT + YT = SY set enormous on paper, three token legs below |
| IMG-STEPS | `how-it-works-morph2-1440.png` | Pinned step 02 "Split", fracture diagram |
| IMG-TRADE | `trade-1440.png` / `-390.png` | Trade screen: live Blend v2 USDC data, 89 days to maturity, amber signals |
| REC-A | recording | Hero liquid metal in motion, slow loop |
| REC-B | recording | Invariant band assembling on scroll: PT slides from the left, YT from the right, SY resolves last |
| REC-C | recording | The pinned how-it-works morph through all three scenes |
| REC-D | recording | Trade screen with odometer values ticking and amber live signals |
| REC-E | recording | Full-page scroll: inertia easing plus the one-pixel filament scrollbar |

### Thesis hooks

**T1 (thread opener, pin candidate)** · 262 chars

> Interest rates are the largest market in traditional finance and one of the least traded things in DeFi. Every lending pool has a rate. Almost nowhere can you trade the rate itself.
>
> We are building that market on Stellar. It starts with one equation.
>
> A thread.

- Media: REC-B (the equation assembling)
- Virality: category-creation framing plus a curiosity gap ("one equation") that the media pays off.
- Thread outline:
  1. (opener above)
  2. In traditional finance, fixed income dwarfs equities. In DeFi, every rate floats and almost nobody can hedge one.
  3. The primitive is yield splitting: take a yield-bearing token and separate the principal from the yield it will earn.
  4. PT is the principal. It trades below par and redeems at par at maturity. The discount is a fixed rate, and no counterparty sets it.
  5. YT is the yield. It collects everything the position earns until maturity, then expires. A pure view on rate direction.
  6. PT + YT = SY at all times. Recombine whenever you want. A 10,000-case randomized property test enforces this on every CI run.
  7. Why Stellar: Blend lending markets, Centrifuge tokenized treasuries, over $2B in RWA by Q1 2026 (stellar.org). The substrate exists; the rates layer did not.
  8. Sidereal is live on Stellar testnet, open source under Apache-2.0. The AMM stays gated until its authorization tree is proven on chain. Repo link.

**T2** · 271 chars

> A yield-bearing token is two products stapled together: the principal and the rate. Held together, you take whatever the market gives you. Split apart, one side becomes a fixed rate and the other a pure position on yield.
>
> Sidereal splits them, on Stellar testnet, today.

- Media: IMG-INV
- Virality: reframe of a familiar object ("two products stapled together") that a non-DeFi reader can repeat.

### Mechanism education

**M1 (the discount is the rate)** · 271 chars

> There is no interest rate anywhere in the PT contract. It redeems at par at maturity and trades below par before that. The discount across the days remaining is the rate, and you know it the moment you sign.
>
> A fixed rate as an emergent property of a discount and a date.

- Media: IMG-TRADE (Buy PT tab visible)
- Virality: contrarian-but-true opener ("no interest rate anywhere in the contract") that resolves cleanly.

**M2 (the invariant)** · 254 chars

> PT + YT = SY.
>
> Split one SY and you hold one PT and one YT. Recombine them and the SY comes back, any moment before maturity. Every state-changing path in the tokenizer preserves this, and a 10,000-case randomized property test proves it on every CI run.

- Media: IMG-INV
- Virality: insider recognition; engineers bookmark property-testing-as-marketing, Pendle users nod at the invariant.

**M3 (thread opener: one pool, three markets)** · 266 chars

> Sidereal has three tradable tokens and exactly one pool.
>
> PT trades against SY directly. YT never touches a second pool: the market borrows SY mid-transaction, mints PT and YT, repays with the PT, hands you the YT. One atomic transaction.
>
> How the flash route works:

- Media: IMG-STEPS
- Virality: apparent paradox (three markets, one pool) that the thread resolves step by step.
- Thread outline:
  1. (opener above)
  2. Why not a second YT/SY pool: Stellar's liquidity base is smaller than Ethereum's, and two pools split depth. One pool means every trade deepens the same book.
  3. Buying YT, step by step: your SY plus flash-borrowed SY goes to the tokenizer, which mints equal PT and YT; the PT repays the pool, the YT comes to you.
  4. Selling YT is the mirror: borrow PT, recombine it with your YT into SY through the tokenizer, repay the pool, keep the remainder.
  5. Soroban makes this native. A transaction fully settles or fully reverts, so there is no separate flash-loan primitive to build or exploit.
  6. Honesty clause: this route passes tests under mocked authorization. Mocked auth is not proof, so the route stays gated until the real auth tree is verified on testnet.
  7. The code is public, Apache-2.0. contracts/amm in the repo. Link.

**M4 (time is the oracle)** · 265 chars

> A constant-product AMM would misprice PT forever, because PT is not a spot asset. It has a date. Sidereal's curve takes time-to-maturity as an input and tightens toward par as the clock runs down. At maturity PT equals 1 SY at any pool balance.
>
> Time is the oracle.

- Media: none (the line carries it)
- Virality: quotable closing line; the kind of sentence CT screenshots and reposts.

**M5 (what YT is)** · 259 chars

> YT is yield with the principal removed. It collects everything the escrow earns until maturity, then expires. No liquidation price, no margin call, no funding rate. The cost of the position is the position.
>
> A view on a rate, in one token in a Stellar wallet.

- Media: IMG-TRADE (Buy YT tab) or none
- Virality: defines a new instrument by what it lacks, which is how traders actually evaluate one.

### The oracle hot take

**O1** · 268 chars

> In February an oracle manipulation took $10.8M from a Stellar protocol. The post-mortem said TWAP is mandatory. We went further: Sidereal's pricing path reads no external feed at all. PT converges to par through the AMM curve itself.
>
> No oracle, nothing to manipulate.

- Media: none. Reply immediately with the post-mortem link (the YieldBlox write-up cited in ARCHITECTURE.md) so the number is sourced in-thread.
- Virality: spiciest true thing available; factual about the event, lets the reader draw the comparison. Never gloats, never names a victim in the tweet body.

**O2 (thread opener)** · 239 chars

> $10.8M left a Stellar lending market in February through a manipulated price feed. Every contract that read the feed trusted it. That is the whole bug.
>
> A short thread on oracle risk, and on designing a rates market that does not have one.

- Media: none
- Virality: narrative momentum; post-mortem content consistently travels on CT because everyone wants the lesson without the loss.
- Thread outline:
  1. (opener above)
  2. How oracle manipulation works in one paragraph: push the reference price inside a window, borrow or drain against the lie, exit before it corrects.
  3. What the February post-mortem concluded: time-weighted pricing is mandatory for any market that lends against yield-bearing collateral.
  4. Our position: TWAP is necessary but the deeper fix is having no external feed in the pricing path at all.
  5. PT can price itself because it has a hard anchor: at maturity it is worth exactly 1 SY, by construction. The AMM curve tightens toward that anchor as time passes.
  6. The pool still maintains an internal TWAP of implied yield (30-minute window, updated every swap) so integrators get a manipulation-resistant read.
  7. Honest limits: an internal TWAP warms up for 30 minutes after deploy and readers are warned in that window. Nothing here is magic, it is scope reduction.
  8. Testnet, open source, Apache-2.0. Read the pricing path yourself. Link.

### Build-in-public

**B1 (deployment proof)** · 269 chars

> Sidereal is on Stellar testnet. Five contracts deployed from a pinned source commit: SY wrapper, PT, YT, tokenizer, AMM. The deploy script generates its own keys, the manifest is public in the repo, and the on-chain wasm hashes match the build.
>
> Verify, don't trust us.

- Media: IMG-TRADE
- Virality: receipts. Reply with the five contract IDs and explorer links from the current `deployments/testnet.toml` (as of 2026-07-03: tokenizer `CDUQRPYG5OKTVXMG7JWYA7FZEBLQEWUHQGCKLAKXKHWWOYRJ4SIQOTXR`, AMM `CCAHVBXVU4VKU7WHYUJ3FH5NKOL7DPVAKA6FKPIQ6P56FUVUXLGTFWJ2`, refresh before posting).

**B2 (the honesty gate)** · 273 chars

> Status, no spin. The settlement core moves real SEP-41 tokens: deposit, split, claim, recombine, redeem, covered by tests that reconcile against actual token balances. The AMM passes 10,000-case property tests under mocked auth. Mocked auth is not proof, so it stays gated.

- Media: none, or a screenshot of the README status table
- Virality: radical candor from a protocol account is rare enough to be the hook; this is the tweet that earns the follow from skeptics.

**B3 (what broke and got fixed)** · 266 chars

> This week's fixes, in public: LPs could not exit the pool after maturity (they can now), a missing Blend USDC trustline surfaced as a generic balance error (it now says so), and the custom scrollbar did not render in Firefox (it does).
>
> The git log is the changelog.

- Media: none
- Virality: specificity is the credibility signal; every builder recognizes each of these three bugs. (Commits: `9f59403`, `66f0291`, `610b78a`.)

### Craft and design

**C1 (the invariant band)** · 258 chars

> Most protocol landing pages shout. Ours sets an equation at nine rem on paper: PT + YT = SY, the invariant every code path preserves. Hover a term and the other two step back.
>
> The brief was a darkroom. Monochrome, one amber accent, reserved for live values.

- Media: REC-B (fallback IMG-INV)
- Virality: aesthetic shock plus a design philosophy stated in one line; travels in design Twitter, not just DeFi.

**C2 (amber as signal)** · 244 chars

> There is exactly one color in Sidereal and it has a job. Everything is monochrome except amber, and amber only marks values that are live from testnet right now: the rate, the claimable yield, the network badge.
>
> If it glows, the chain said so.

- Media: REC-D (fallback IMG-TRADE)
- Virality: a single memorable design rule ("if it glows, the chain said so") that doubles as a testnet-honesty statement.

**C3 (the scrollbar)** · 207 chars

> We replaced the browser scrollbar with a one-pixel filament and gave the page inertia. Then we spent a commit getting the filament to render in Firefox.
>
> Most people will never notice. That is why we did it.

- Media: REC-E
- Virality: craft-obsession humblebrag; dev and design communities reliably circulate "we sweat the invisible detail" posts.

### Ecosystem

**E1 (the Stellar substrate)** · 256 chars

> Stellar quietly assembled the substrate for fixed income: Blend lending markets, Centrifuge tokenized treasuries, over $2B in RWA by Q1 2026 (stellar.org). Missing: the layer that turns a floating rate into a fixed one.
>
> That layer is what we are building.

- Media: IMG-HERO
- Virality: gives the Stellar community a flattering, sourced narrative about itself to retweet.

**E2 (Soroban floats)** · 274 chars

> Soroban's wasm VM rejects float opcodes, so our AMM math is 128-bit fixed point. But native test builds tolerate floats that wasm will not, so tests can pass on math that cannot deploy. CI builds every contract to wasm and fails on any float opcode.
>
> The VM is the reviewer.

- Media: none, or a screenshot of `scripts/check-wasm-floats.sh`
- Virality: a real, non-obvious Soroban footgun with the fix included; the exact post Soroban devs bookmark and share.

**E3 (mobile-first, LATAM)** · 271 chars

> Sidereal is mobile-first because Stellar is. The chain's traction is payments and remittances, much of it on phones in Latin America. A fixed savings rate you can lock from the same phone that receives the remittance is the point of putting a rates market on these rails.

- Media: IMG-TRADE at 390px (`trade-390.png`)
- Virality: connects DeFi mechanics to a human use case; the phone-width screenshot proves the claim instead of asserting it. (AGENTS.md states half of LATAM Stellar wallet users are on phones; that precise figure needs a public source before it goes in copy, so this tweet stays qualitative.)

### Wildcard

**W1 (the name)** · 239 chars

> A sidereal day is time kept by the stars instead of the sun. We named the protocol Sidereal because it is, mostly, a clock. The AMM prices by time-to-maturity. PT converges as the calendar runs. YT expires at zero.
>
> Stellar keeps the time.

- Media: REC-A (the hero, slow)
- Virality: name-lore posts humanize protocol accounts and get quote-tweeted; this one restates the entire mechanism inside the etymology.

---

## Deliverable 2: the page plan

### Identity

**Handle.** First choice `@sidereal_fi`, fallbacks `@siderealfi`, `@siderealxyz`.
Check availability before creating; `@sidereal` alone is almost certainly taken.
Avoid anything with "protocol" in it, the account should read like a studio, not
a ticker.

**Display name.** `Sidereal`.

**Bio** (148 chars, under the 160 limit):

> Fixed and floating yield on Stellar. Split Blend USDC into principal and yield tokens. One pool, zero external oracles. Live on testnet. Open source.

Link field: the repo (until the hosted demo is stable, then the demo). Location
field: "Stellar testnet".

**Pinned tweet.** T1, the thesis thread. Reasoning: the pinned slot answers "what
is this account" for every profile visitor arriving from a reply or a retweet.
Build-in-public tweets age within a week; the thesis does not, and the thread's
final tweet carries the repo link and the testnet status, so the pin also does
compliance work.

**Avatar.** The four-point star glyph from the site header, paper white on ink,
no wordmark, generous margin. Never amber; the avatar is not a live signal.

**Banner.** Near-black field carrying the star-chart atlas motif: faint
concentric rings bleeding off the right edge (the InkRings pattern from the
invariant band, inverted to white on ink), the equation `PT + YT = SY` set small
in light mono type at lower left, and a single amber point sitting on one ring.
One amber element, nothing else colored. It should read as an instrument panel
at rest, not a poster.

### Content engine

A two-person team sustains 4 to 5 originals per week plus replies. That beats
three a day for two weeks followed by silence, and the categories map onto a
repeating week:

| Slot | Category | Notes |
|---|---|---|
| Monday | Mechanism education | One concept per post. Every fourth Monday is a thread (M3/O2 class). |
| Wednesday | Build-in-public | Sourced from the week's actual git log. If the week was ugly, say so; B2 is the template. |
| Friday | Craft/design or ecosystem, alternating | Craft posts get the recordings; ecosystem posts get the sourced-narrative treatment (E1). |
| Saturday (optional) | Dev-audience content (E2 class) | Devs browse weekends; skip freely when there is nothing real. |
| Daily | 3 to 5 replies | See engagement strategy. Replies are the growth engine at zero followers, not the originals. |

Rules of the engine: no post without a named virality mechanism, no number
without a source, every app screenshot shows the testnet badge, threads never
exceed 8 tweets, and one banked evergreen post (M4, W1 class) stays in reserve
for weeks when the build produces nothing tweetable.

### Engagement strategy

**Who matters (verify every handle before following; those marked ~ are
inferred and unverified).** Roughly 18 targets across six groups:

1. Stellar core: Stellar / SDF (`@StellarOrg`), the SDF developer account (~`@BuildOnStellar`), Stellar Community Fund (handle unverified), individual SDF DevRel engineers active on Soroban (identify from recent Soroban content, e.g. Tyler van der Hoeven, ~`@tyvdh`).
2. The immediate ecosystem: Blend Capital (~`@blend_capital`) and the Script3 team behind it, Centrifuge (~`@centrifuge`), Aquarius, Freighter and xBull wallet accounts. These are integration-adjacent; warmth here compounds.
3. Pendle world: Pendle (~`@pendle_fi`) and the recurring authors of Pendle strategy threads (identify by searching "PT YT" thread authors; do not guess names). They already understand the mechanism and are the likeliest quote-tweeters of M1/M3/M4.
4. DeFi educators and researchers: the handful of large accounts that explain mechanisms rather than shill (Ignas, The DeFi Edge, and current equivalents; verify who is still active), plus analysts at Messari / Delphi / Blockworks covering yield markets.
5. Aggregators: DeFiLlama (for the eventual listing), RWA-focused trackers.
6. The SCF community: fellow grantees and Build Station cohort accounts; small, but they reply, and early replies decide whether the algorithm shows anyone the originals.

**Reply-guy doctrine.** Add mechanism insight or a sourced fact under large
conversations about rates, Pendle, RWA, or Stellar. The reply should be useful
with the account name covered. Never "gm ser", never "this" plus emoji, never a
link drop in someone else's thread unless asked. One reply that teaches beats
ten that wave.

**Quote-tweet angles.** Stellar ecosystem announcements (add the fixed-income
angle), Pendle mechanism threads (add the Soroban implementation contrast),
oracle-incident post-mortems anywhere in crypto (add the design lesson, factually,
per the O1 rules).

**Never touch.** Price talk of any token including XLM; other protocols' exploits
beyond the factual design lesson, and never while victims are still counting
losses; chain-war bait (Stellar vs anything); yield-figure one-upmanship;
airdrop speculation about Sidereal (there is no token, say so plainly if asked).

### Launch sequence (day by day, from zero followers)

Sequencing argument: pin the thesis, but distribute through build-in-public.
A zero-follower account's thesis thread will be read by almost nobody on day
one, and that is fine, because its job is to be the pin that converts profile
visits later. The tweets that generate the first profile visits are receipts
(B1) and replies, because they surface in other people's threads where the
audience already is. The oracle thread waits until week two: a hot take from a
day-old account reads as engagement farming; the same take from an account with
a deployment manifest and a week of honest changelogs reads as earned.

Week 1:

- Day 1 (Mon): profile assets live. Post T1 thread, pin it. Follow the verified target list. No other posts.
- Day 2 (Tue): B1 with IMG-TRADE, contract IDs and explorer links in the first reply. Three replies in ecosystem conversations.
- Day 3 (Wed): M2 with IMG-INV. Replies.
- Day 4 (Thu): no original. Replies only; note which day-2/3 posts earned profile clicks.
- Day 5 (Fri): C1 with REC-B. Share into design-adjacent conversations if any are live.
- Day 6 (Sat): E2, the Soroban float post. Dev audiences browse weekends.
- Day 7 (Sun): quiet. Queue week 2, review what the first five posts did.

Week 2:

- Day 8 (Mon): M3 flash-route thread.
- Day 9 (Tue): B3, the week's real fixes (regenerate from the actual git log that week; the version above is illustrative of the format).
- Day 10 (Wed): M1 with IMG-TRADE.
- Day 11 (Thu): C3 with REC-E. Replies.
- Day 12 (Fri): O2 oracle thread. This is the credibility-spend moment; the account now has receipts behind it.
- Day 13 (Sat): E1 with IMG-HERO.
- Day 14 (Sun): W1 as the soft close of the launch fortnight. Full metrics review.

Held in reserve for weeks 3 and 4: T2, M4, M5, O1, B2, C2, E3. B2 in particular
should land whenever someone first asks "is the AMM live", as a standalone
answer.

### Growth loops

- **Repo as content.** Every mechanism tweet links a real file. Readers who click through and find clean, licensed, tested code convert to follows at a far higher rate than readers who find a landing page. The README is a marketing surface; keep its status table honest and current.
- **Demo video.** The 2-minute demo (AGENTS.md section 14 committed to one) becomes the pinned reply under T1 once it exists, and the highest-value asset for every "what is this" reply.
- **SCF and Build Station milestones.** Each milestone announcement is a B-category post with receipts, and the SCF community amplifies its own cohort. Community calls are a speaking slot; the M3/O2 threads are the talk track.
- **Design communities.** C-category posts travel through design and frontend Twitter, which DeFi accounts never reach. That audience follows for craft and stays for the build; it is also where future frontend contributors come from.
- **Funnel mapping.** Impressions come from replies and quote-tweets; profile visits convert on the pin (T1) and bio; follows convert to demo clicks through B-category receipts; demo clicks convert to repo stars and testnet wallets through the app itself. Each category exists to move one specific edge of that funnel: thesis converts visits, mechanism earns bookmarks, build earns trust, craft imports new audiences, ecosystem earns local amplification.

### Measurement

At this stage impressions are noise. Weekly review, 30 minutes, on:

1. **Bookmarks per original.** The single best proxy for "this taught someone something". Mechanism and dev posts live or die here.
2. **Profile-click rate per post.** Which categories make people want to know who wrote it.
3. **Follows per week**, segmented by what the follower is (builder, Stellar community, Pendle user, designer) on a quick manual scan.
4. **Replies from target-list accounts.** One reply from an SDF engineer is worth more than a thousand anonymous impressions.
5. **Link clicks** to repo and demo.

Kill criteria: a content category that posts four consecutive originals below
the account's median engagement with zero bookmarks gets one format rework; if
the rework also misses, the category is dropped and its slot goes to the best
performer. Review the kill list monthly, not daily; small accounts need sample
size before verdicts.

### Risk notes

The three most likely ways this account embarrasses the protocol, and the
standing rule that prevents each:

1. **Overclaiming yield.** One invented or stale APY screenshot can undo every honesty signal above. Standing rule: no market number appears in any post without a named source and a date, checked at post time, and protocol constants (redeems at par, 3-month series, zero external oracles) are the only numbers that need no citation. The live Blend APR shown in app screenshots is acceptable because the UI labels it variable and testnet.
2. **Testnet/mainnet confusion.** Someone will try to deposit real funds if given any excuse. Standing rule: every post that shows the app or invites interaction carries "testnet" in the copy or visibly in the image, and the words "deposit", "earn", or "buy" are never used as imperatives addressed at the reader. The bio states testnet at all times until mainnet exists.
3. **Engagement-farming cringe.** One "wen token" joke or exploit dunk converts the account from educator to noise. Standing rule: every original must have a nameable virality mechanism before posting (the discipline used in this document), and any post about a third-party incident states facts, cites the post-mortem, and mentions no victim by name in the tweet body. If a draft feels clever at someone's expense, it does not post.

---

## Appendix A: product brief

Sidereal is real-settlement yield tokenization on Stellar, modeled on Pendle V2
and adapted for Soroban. It takes Blend's USDC lending position, wraps it into a
standardized yield-bearing share (SY, an ERC-4626-style vault built on
OpenZeppelin's Soroban Vault extension), and splits that share into two SEP-41
tokens: PT, the principal, which redeems for exactly its face value in
underlying at maturity, and YT, which collects all yield the escrowed position
earns between split and maturity, then expires. PT plus YT always recombines
into SY; the tokenizer asserts an escrow-coverage invariant after every mutating
call and a 10,000-case randomized property test exercises the conservation law
in CI. Because PT trades below par before maturity, its discount over the days
remaining is a fixed rate that no counterparty sets; because YT is the yield
with the principal removed, it is a pure instrument on rate direction.

Both tokens trade through a single PT/SY pool whose curve, adapted from Pendle
V2 and ultimately Notional's math, takes time-to-maturity as an explicit input
and tightens toward par as expiry approaches. This removes the need for any
external price oracle: at maturity PT is worth 1 SY by construction, and the
pool maintains an internal 30-minute TWAP of implied yield for integrators. The
relevance is local and recent: Stellar's February 2026 YieldBlox incident was a
$10.8M oracle manipulation, and Sidereal's pricing path contains no external
feed to manipulate. YT trades route through the same pool via flash swap
(borrow, mint via tokenizer, repay, deliver) in one atomic Soroban transaction,
so one liquidity book serves three markets on a chain where liquidity is scarce.

Status, honestly: the settlement core (deposit, split, claim, recombine, redeem)
moves real SEP-41 tokens on Stellar testnet, deployed 2026-07-03 from a pinned
commit with a public manifest and matching on-chain wasm hashes. The AMM and the
YT flash route are implemented and property-tested but pass only under mocked
authorization, so the team gates them from demos until the nested auth tree is
proven on chain. Everything is Apache-2.0 and public from day one. All
transactions are built by the SDK, signed client-side, and never touch a
server-held key. The app is mobile-first, monochrome with a single amber accent
reserved for live on-chain values, and its landing page states the protocol's
one invariant at nine rem: PT + YT = SY.

What makes it tweetable is the specifics: one pool serving three markets, YT
bought via flash swap in a single transaction, a fixed rate that emerges from a
discount and a date rather than a counterparty, an AMM that needs no oracle
because time itself converges the price, a CI guard that greps compiled wasm for
float opcodes, and a team that publicly gates its own AMM until the auth tree is
proven.

## Appendix B: media asset inventory

Screenshots (captured 2026-07-04, `docs/marketing/assets/`, uncommitted; retake
before posting if the UI has moved):

- `landing-hero-1440.png`, `landing-hero-390.png`
- `invariant-band-1440.png`, `invariant-band-390.png`
- `how-it-works-1440.png`, `how-it-works-morph2-1440.png`, `how-it-works-390.png`
- `trade-1440.png`, `trade-390.png`

Recordings for a human to capture (5 to 10 seconds each, 1440px, 60fps, exported
under 20MB for native playback):

- REC-A: hero liquid metal drifting, no cursor. For W1, alternates for E1.
- REC-B: scroll into the invariant band so PT and YT slide in and SY resolves. For T1 and C1.
- REC-C: the full pinned how-it-works morph, steady scroll. For M3 if an image is not enough.
- REC-D: trade screen with odometer values ticking; make sure the amber testnet badge is in frame. For C2.
- REC-E: a full-page scroll showing inertia easing and the filament scrollbar; capture in a Chromium browser. For C3.

Capture notes: dark theme only (there is no light theme), hide the cursor except
where interaction is the point (the invariant-band hover), and crop out the OS
chrome. Phone-width captures use 390px and should include the testnet badge.
