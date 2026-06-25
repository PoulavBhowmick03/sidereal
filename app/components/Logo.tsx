// SPDX-License-Identifier: Apache-2.0

/** Sidereal mark: a four-point star (sidereal = "relating to the stars"). */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 1.5l2.2 7.3 7.3 2.2-7.3 2.2L12 22.5l-2.2-7.3L2.5 13l7.3-2.2L12 1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Logo />
      <span className="text-lg font-semibold tracking-tight">sidereal</span>
    </span>
  );
}
