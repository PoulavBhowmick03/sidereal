// SPDX-License-Identifier: Apache-2.0

import { formatMaturityDate, maturityStatus } from "@/lib/format";

export function MaturityBadge({ maturity }: { maturity: number | null }) {
  if (maturity === null) {
    return (
      <div className="panel-subtle inline-flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="label-data">Series maturity</span>
        <span className="text-sm text-ash">Not deployed yet</span>
      </div>
    );
  }

  return (
    <div className="panel-subtle inline-flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <span className="label-data">Series maturity</span>
      <span className="text-sm tabular-nums text-paper">{maturityStatus(maturity)}</span>
      <span className="hidden h-1 w-1 rounded-pill bg-white/25 sm:block" aria-hidden />
      <span className="text-sm tabular-nums text-smoke">{formatMaturityDate(maturity)}</span>
    </div>
  );
}
