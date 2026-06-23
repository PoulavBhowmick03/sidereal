// SPDX-License-Identifier: Apache-2.0

export default function RedeemPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Redeem</h1>
      <p className="text-slate-300">
        At or after maturity, redeem PT 1:1 for the underlying. Before maturity, recombine equal
        amounts of PT and YT back into SY at any time. The page picks the right action based on the
        market&apos;s maturity.
      </p>
      <p className="text-sm text-slate-400">Redeem and recombine forms land in the next iteration.</p>
    </div>
  );
}
