// SPDX-License-Identifier: Apache-2.0

import Link from "next/link";

export function RollingLink({
  href,
  children,
  className = "",
  onClick,
}: {
  href: string;
  children: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link href={href} className={`roll ${className}`} onClick={onClick}>
      <span className="roll-label">
        {children}
        <span aria-hidden className="roll-label-copy">
          {children}
        </span>
      </span>
    </Link>
  );
}
