// SPDX-License-Identifier: Apache-2.0

// Sparse star speckle for the page body: the footer starfield's language at a
// fraction of its density, so the mid-page void reads as sky, not as gap.
const BODY_STARS = [
  "radial-gradient(1.2px 1.2px at 40px 60px, rgba(255,255,255,0.5), transparent)",
  "radial-gradient(1px 1px at 200px 220px, rgba(255,255,255,0.35), transparent)",
  "radial-gradient(1.4px 1.4px at 340px 120px, rgba(255,255,255,0.45), transparent)",
  "radial-gradient(1px 1px at 460px 320px, rgba(255,255,255,0.3), transparent)",
  "radial-gradient(1.2px 1.2px at 120px 420px, rgba(255,255,255,0.4), transparent)",
].join(",");

// The signature backdrop: a sidereal star chart. One huge concentric ring
// system, fixed behind the page, turning once every four minutes. It gives
// the space between sections a composed structure and carries the footer's
// chart motif through the whole page.
function ChartRings() {
  return (
    <svg
      className="chart-rings absolute left-1/2 top-1/2 h-[170vmax] w-[170vmax] -translate-x-1/2 -translate-y-1/2"
      viewBox="0 0 1000 1000"
      fill="none"
      stroke="rgba(255,255,255,0.04)"
      aria-hidden
    >
      {[120, 210, 300, 390, 480].map((r) => (
        <circle key={r} cx="500" cy="500" r={r} strokeWidth="1" />
      ))}
      {/* One eccentric orbit and its body, slightly brighter, so the system
          reads as a chart rather than a target. */}
      <circle cx="500" cy="500" r="345" strokeWidth="1" stroke="rgba(255,255,255,0.07)" strokeDasharray="2 10" />
      <circle cx="845" cy="500" r="3" fill="rgba(255,255,255,0.22)" stroke="none" />
      {/* Radial ticks at the cardinal points. */}
      {[0, 90, 180, 270].map((a) => {
        const x = 500 + 480 * Math.cos((a * Math.PI) / 180);
        const y = 500 + 480 * Math.sin((a * Math.PI) / 180);
        const x2 = 500 + 456 * Math.cos((a * Math.PI) / 180);
        const y2 = 500 + 456 * Math.sin((a * Math.PI) / 180);
        return <line key={a} x1={x} y1={y} x2={x2} y2={y2} strokeWidth="1" stroke="rgba(255,255,255,0.1)" />;
      })}
    </svg>
  );
}

export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#000000_0%,#05070d_52%,#080a10_100%)]" />
      <div
        className="absolute inset-0 opacity-70"
        style={{ backgroundImage: BODY_STARS, backgroundRepeat: "repeat", backgroundSize: "520px 520px" }}
      />
      <ChartRings />
      <div className="atmosphere-nebula atmosphere-nebula-white hidden lg:block" />
      <div className="atmosphere-nebula atmosphere-nebula-blue hidden lg:block" />
      {/* Vignette: seats the corners so content reads against a stage. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_40%,transparent_55%,rgba(0,0,0,0.5)_100%)]" />
    </div>
  );
}
