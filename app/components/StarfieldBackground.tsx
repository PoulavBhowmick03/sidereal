// SPDX-License-Identifier: Apache-2.0

// Faded "sidereal" starfield behind the footer: a deep-space base, two tiled
// star layers for depth, a faint concentric star-chart grid, and a soft nebula
// glow. Everything is dimmed so the giant wordmark stays dominant. Recreated in
// CSS/SVG rather than shipping the reference render.
const STARS_NEAR = [
  "radial-gradient(1.4px 1.4px at 30px 40px, #fff, transparent)",
  "radial-gradient(1px 1px at 90px 130px, rgba(255,255,255,0.7), transparent)",
  "radial-gradient(1px 1px at 160px 70px, rgba(255,255,255,0.8), transparent)",
  "radial-gradient(1px 1px at 200px 190px, rgba(255,255,255,0.6), transparent)",
  "radial-gradient(1.6px 1.6px at 130px 210px, #fff, transparent)",
  "radial-gradient(1px 1px at 60px 100px, rgba(255,255,255,0.5), transparent)",
  "radial-gradient(1px 1px at 225px 45px, rgba(255,255,255,0.7), transparent)",
].join(",");

const STARS_FAR = [
  "radial-gradient(1.8px 1.8px at 60px 60px, #fff, transparent)",
  "radial-gradient(2px 2px at 330px 220px, rgba(255,255,255,0.9), transparent)",
  "radial-gradient(1.6px 1.6px at 210px 360px, rgba(255,255,255,0.8), transparent)",
  "radial-gradient(1.2px 1.2px at 400px 110px, rgba(255,255,255,0.6), transparent)",
].join(",");

export function StarfieldBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Deep space base. */}
      <div className="absolute inset-0 bg-[#080a10]" />

      {/* Soft nebula. */}
      <div className="absolute inset-0 bg-[radial-gradient(70%_90%_at_35%_45%,rgba(120,140,180,0.12),transparent_60%)]" />

      {/* Two tiled star layers. */}
      <div
        className="absolute inset-0 opacity-80"
        style={{ backgroundImage: STARS_NEAR, backgroundRepeat: "repeat", backgroundSize: "240px 240px" }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{ backgroundImage: STARS_FAR, backgroundRepeat: "repeat", backgroundSize: "440px 440px" }}
      />

      {/* Faint concentric star-chart grid, anchored left like the reference. */}
      <svg
        className="absolute left-[10%] top-1/2 h-[160%] w-auto -translate-y-1/2 text-white/[0.06]"
        viewBox="0 0 600 600"
        fill="none"
        stroke="currentColor"
      >
        {[80, 150, 220, 290, 360].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} strokeWidth="1" />
        ))}
        {[0, 45, 90, 135].map((a) => (
          <line
            key={a}
            x1="300"
            y1="300"
            x2={300 + 360 * Math.cos((a * Math.PI) / 180)}
            y2={300 + 360 * Math.sin((a * Math.PI) / 180)}
            strokeWidth="1"
          />
        ))}
      </svg>

      {/* Dim the whole field so the wordmark reads on top. */}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/40 to-ink/30" />
    </div>
  );
}
