// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";
import { StepNumeral } from "@/components/StepNumeral";
import { HeroBackground } from "@/components/HeroBackground";
import { Parallax } from "@/components/Parallax";
import { InvariantBand } from "@/components/InvariantBand";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { StepDiagram } from "@/components/StepDiagrams";
import { PinnedSteps } from "@/components/PinnedSteps";
import { AudienceCards } from "@/components/AudienceCards";
import { GuaranteesStrip } from "@/components/GuaranteesStrip";
import { Spotlight } from "@/components/Spotlight";
import { TickerBand } from "@/components/TickerBand";
import { Term } from "@/components/Term";
import { WordReveal } from "@/components/WordReveal";
// The token legs live in InvariantBand, defined in the protocol's own terms.
// No invented financial figures anywhere on this page.
// Token names in the copy carry the mono Term voice so they read as objects.
const STEPS = [
  {
    n: "01",
    title: "Deposit and mint",
    kicker: "Action / Supply",
    body: (
      <>
        Deposit <Term>USDC</Term>. The protocol wraps it into Standardized Yield, ready for the
        splitting mechanism.
      </>
    ),
    band: "ink" as const,
  },
  {
    n: "02",
    title: "Split",
    kicker: "Mechanism / Fracture",
    body: (
      <>
        <Term>SY</Term> fractures into two parts. The principal is secured as <Term>PT</Term>,
        the yield is isolated as <Term>YT</Term>.
      </>
    ),
    band: "carbon" as const,
  },
  {
    n: "03",
    title: "Trade or hold",
    kicker: "Outcome / Market",
    body: (
      <>
        Hold <Term>PT</Term> to maturity for a fixed return, or trade either leg on a time-decay
        AMM priced by an internal TWAP.
      </>
    ),
    band: "ink" as const,
  },
];

// Protocol facts, stated as oversized numerals. These are design choices that
// hold regardless of deployment, not market metrics.
const FACTS = [
  { value: "01", label: "Active market", note: "Blend USDC", signal: false },
  { value: "03", label: "Token legs", note: "SY · PT · YT", signal: false },
  { value: "00", label: "Price oracles", note: "Internal TWAP", signal: false },
  { value: "1:1", label: "PT at maturity", note: "Redeems to par", signal: false },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero: clean ink editorial frame, no atmospheric render. The headline
          carries the section; the metallic background lives on the app screens. */}
      <section className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-transparent">
        <HeroBackground />
        <Parallax speed={0.12} className="relative mx-auto w-full max-w-[1280px] px-6 sm:px-16">
          <h1 className="hero-shimmer max-w-4xl text-5xl font-light leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
            Split Stellar yield into principal and yield.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-smoke">
            Deposit USDC. Mint SY. Separate fixed principal from variable yield, and trade both.
          </p>
          <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <Link
              href="/trade"
              className="rounded-pill bg-paper px-7 py-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink transition hover:bg-smoke"
            >
              Launch App
            </Link>
            <span className="font-mono text-sm tracking-[0.2em] text-ash">
              Blend USDC · 3-month maturity
            </span>
          </div>
        </Parallax>
        <Parallax
          fadeDistance={280}
          className="absolute bottom-8 left-6 flex items-center gap-3 sm:left-16"
        >
          <span className="label-data">Scroll</span>
          <span className="h-px w-10 bg-ash" />
        </Parallax>
      </section>

      {/* Invariant band: the protocol's thesis, set enormous on paper, with
          the three legs linked to the equation terms on hover. */}
      <InvariantBand />

      {/* How it works. Desktop: the band pins and one scene morphs through the
          three moments in place (PinnedSteps). Mobile and reduced motion: the
          editorial stacked bands, each with its own animated diagram. */}
      <section id="how-it-works">
        <div className="steps-pinned hidden lg:block">
          <PinnedSteps steps={STEPS.map(({ n, title, kicker, body }) => ({ n, title, kicker, body }))} />
        </div>
        <div className="steps-stacked lg:hidden">
        {STEPS.map((step) => (
          <div
            key={step.n}
            className={step.band === "carbon" ? "bg-carbon" : "bg-ink"}
          >
            <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-6 py-20 sm:px-16 lg:grid-cols-2">
              <div>
                <StepNumeral>{step.n}</StepNumeral>
                <Reveal>
                  <h2 className="mt-6 text-4xl font-light tracking-tight sm:text-5xl">{step.title}</h2>
                  <p className="mt-3 label-data">{step.kicker}</p>
                  <p className="mt-6 max-w-xl text-lg leading-relaxed text-smoke">{step.body}</p>
                </Reveal>
              </div>
              <div className="flex justify-center lg:justify-end">
                <StepDiagram n={step.n} />
              </div>
            </div>
          </div>
        ))}
        </div>
      </section>

      <TickerBand />
      <AudienceCards />
      <GuaranteesStrip />

      {/* Protocol overview: facts as numerals in an enclosed panel, not invented
          market metrics. */}
      <section className="relative bg-transparent">
        <div className="hairline" />
        <div className="mx-auto max-w-[1280px] px-6 py-20 sm:px-16">
          <div className="flex items-center justify-between">
            <h2 className="text-4xl font-light tracking-tight sm:text-5xl">
              <WordReveal brightWords={[0]}>Protocol overview</WordReveal>
            </h2>
            <p className="glow-signal label-data text-amber">Live · Testnet</p>
          </div>
          <div className="mt-12 grid grid-cols-2 border border-white/10 lg:grid-cols-4">
            {FACTS.map((fact, i) => (
              <Spotlight
                key={fact.label}
                className={`p-8 ${i < FACTS.length - 1 ? "border-b border-white/10 lg:border-b-0 lg:border-r" : ""} ${
                  i < 2 ? "border-b lg:border-b-0" : ""
                }`}
              >
                <p
                  className={`text-5xl font-light tabular-nums tracking-tight sm:text-6xl ${
                    fact.signal ? "text-amber" : "text-paper"
                  }`}
                >
                  <CountUp value={fact.value} />
                </p>
                <p className="mt-4 label-data">{fact.label}</p>
                <p className="mt-1 text-sm text-pewter">{fact.note}</p>
              </Spotlight>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
