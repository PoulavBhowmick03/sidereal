// SPDX-License-Identifier: Apache-2.0

const FACTS = [
  "1 PT + 1 YT = 1 SY",
  "Internal TWAP",
  "No external oracles",
  "Client-side signing",
  "Blend USDC",
  "3-month maturity",
];

function FactSequence({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {FACTS.map((fact) => (
        <span key={fact} className="flex shrink-0 items-center">
          <span>{fact}</span>
          <span className="px-6 text-white/25" aria-hidden>
            ·
          </span>
        </span>
      ))}
    </div>
  );
}

export function TickerBand() {
  return (
    <section aria-label="Protocol facts" className="relative h-16 overflow-hidden">
      <div className="hairline absolute inset-x-0 top-0" />
      <div className="ticker-track label-data flex h-full w-max items-center whitespace-nowrap">
        <FactSequence />
        <FactSequence hidden />
      </div>
      <div className="hairline absolute inset-x-0 bottom-0" />
    </section>
  );
}
