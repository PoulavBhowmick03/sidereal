// SPDX-License-Identifier: Apache-2.0

export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#000000_0%,#05070d_52%,#080a10_100%)]" />
      <div className="atmosphere-nebula atmosphere-nebula-white hidden lg:block" />
      <div className="atmosphere-nebula atmosphere-nebula-blue hidden lg:block" />
    </div>
  );
}
